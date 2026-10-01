// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { appendBreadcrumb } from "@/lib/crash-log";
import { checkAppUpdate, downloadAndInstallUpdate, type AppUpdateInfo } from "@/settings/app-update";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { installCrashLogger } from "@/lib/crash-log";
import type { RootStackParamList, RootTabParamList } from "@/navigation/types";
import { CharactersScreen } from "@/screens/characters-screen";
import { AssistantScreen } from "@/screens/assistant-screen";
import { ProjectsScreen } from "@/screens/projects-screen";
import { SettingsScreen } from "@/screens/settings-screen";
import { StyleLibraryScreen } from "@/screens/style-library-screen";
import { WritingScreen } from "@/screens/writing-screen";
import { NotesScreen } from "@/screens/notes-screen";
import { WorldInfoScreen } from "@/screens/world-info-screen";
import { colors } from "@/theme";
import { getRuntimeResourceState, type RuntimeResourceState } from "@/settings/remote-resources";
import { warmUpLocalModels } from "@/search/local-models";

// 在渲染任何界面之前挂载全局错误处理，保证最早发生的异常也能被记录。
installCrashLogger();

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: 58 + insets.bottom,
            paddingBottom: Math.max(insets.bottom, 5),
            paddingTop: 4,
          },
          tabBarHideOnKeyboard: true,
          tabBarLabelStyle: { fontSize: 11 },
          tabBarIcon: ({ color, size }) => {
            const icons: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
              Projects: "library-outline",
              Writing: "create-outline",
              Assistant: "sparkles-outline",
              Settings: "settings-outline",
            };
            return <Ionicons name={icons[route.name]} color={color} size={size} />;
          },
        })}
      >
        <Tab.Screen name="Projects" component={ProjectsScreen} options={{ title: "书架" }} />
        <Tab.Screen name="Writing" component={WritingScreen} options={{ title: "写作" }} />
        <Tab.Screen name="Assistant" component={AssistantScreen} options={{ title: "助手" }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: "设置" }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider preserveEdgeToEdge>
        <RuntimeResourceGate />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function RuntimeResourceGate() {
  const [state, setState] = useState<RuntimeResourceState | null>(null);
  const [checking, setChecking] = useState(true);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getRuntimeResourceState();
        if (!cancelled) setState(next);
      } catch (checkError) {
        if (!cancelled) setError(checkError instanceof Error ? checkError.message : String(checkError));
      } finally {
        if (!cancelled) setChecking(false);
      }
      // 本地检索模型改为后台静默预热：即便失败也不影响进入应用。
      void warmUpLocalModels().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <View style={styles.resourceLoading}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.resourceProgress}>正在准备…</Text>
      </View>
    );
  }

  // 只有「必需」内容缺失才拦人 —— 而且必须留一条退路，绝不把用户锁死在启动页。
  // 可选资源（检索模型、进阶内容包）缺失一律不阻塞，进应用后在设置里按需补齐。
  if (state && !state.ready && !skipped) {
    return (
      <View style={styles.resourceGate}>
        <StatusBar style="dark" />
        <Text style={styles.resourceTitle}>缺少必需内容</Text>
        <Text style={styles.resourceSubtitle}>以下内容为助手运行所需。缺失部分仅影响对应功能，可先进入应用，稍后在设置中处理。</Text>
        <View style={styles.resourceList}>
          {state.missing.map((item) => (
            <View key={item.id} style={styles.resourceRow}>
              <View style={styles.resourceDot} />
              <View style={styles.resourceCopy}>
                <Text style={styles.resourceLabel}>{item.label}</Text>
                <Text style={styles.resourceDetail}>{item.detail}</Text>
              </View>
            </View>
          ))}
        </View>
        {error ? <Text style={styles.resourceProgress}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => setSkipped(true)} style={styles.downloadButton}>
          <Text style={styles.downloadButtonText}>跳过并进入应用</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
    <NavigationContainer
      onStateChange={(state) => {
        try {
          // 递归下钻嵌套导航状态，取当前最深层路由名（Stack → Tab → 页面）
          type NavNode = { index?: number; routes?: NavNode[]; name?: string; state?: NavNode };
          let node = state as unknown as NavNode | undefined;
          while (node?.routes?.length) {
            const next = node.routes[node.index ?? 0];
            if (!next) break;
            if (next.state) { node = next.state; continue; }
            appendBreadcrumb(`进入「${next.name ?? "未知"}」`);
            return;
          }
        } catch {}
      }}
    >
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Characters" component={CharactersScreen} />
        <Stack.Screen name="WorldInfo" component={WorldInfoScreen} />
        <Stack.Screen name="Notes" component={NotesScreen} />
        <Stack.Screen name="StyleLibrary" component={StyleLibraryScreen} />
      </Stack.Navigator>
    </NavigationContainer>
    <AppUpdatePopup />
    </>
  );
}

const styles = StyleSheet.create({
  updateBackdrop: { flex: 1, backgroundColor: "rgba(20,21,19,0.45)", alignItems: "center", justifyContent: "center", padding: 28 },
  updateCard: { alignSelf: "stretch", backgroundColor: "#FFFFFF", borderRadius: 16, padding: 18 },
  updateTitle: { fontSize: 17, fontWeight: "700", color: "#20211F" },
  updateHint: { marginTop: 8, fontSize: 13, color: "#696B66", lineHeight: 19 },
  updateNotesScroll: { maxHeight: 260, marginTop: 10 },
  updateNoteSection: { marginTop: 8, marginBottom: 2, fontSize: 13, fontWeight: "700", color: "#20211F" },
  updateNoteRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  updateNoteBullet: { color: "#176B57", fontSize: 13, lineHeight: 20 },
  updateNoteText: { flex: 1, fontSize: 13, lineHeight: 20, color: "#3B3C3A" },
  updateDetail: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: "#EFEFEC" },
  updateDetailText: { color: "#20211F", fontSize: 14, fontWeight: "600" },
  updateActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  updateLater: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: "#EFEFEC" },
  updateLaterText: { color: "#20211F", fontSize: 14, fontWeight: "600" },
  updateNow: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12, backgroundColor: "#176B57" },
  updateNowBusy: { opacity: 0.6 },
  updateNowText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  resourceGate: { flex: 1, justifyContent: "center", padding: 28, backgroundColor: colors.background },
  resourceLoading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: colors.background },
  resourceTitle: { color: colors.text, fontSize: 28, fontWeight: "800" },
  resourceSubtitle: { marginTop: 10, color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  resourceList: { marginTop: 28, gap: 14 },
  resourceRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  resourceDot: { width: 9, height: 9, marginTop: 6, borderRadius: 5, backgroundColor: colors.primary },
  resourceCopy: { flex: 1, gap: 2 },
  resourceLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  resourceDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  resourceProgress: { marginTop: 24, color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  downloadButton: { minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 20, borderRadius: 8, backgroundColor: colors.primary },
  downloadButtonDisabled: { opacity: 0.55 },
  downloadButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  retryResourceButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  retryResourceText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
});

/** 把 Release 说明（Markdown）拆成弹窗里的行：标题行与条目行。 */
const parseUpdateNotes = (notes: string): Array<{ kind: "section" | "item"; text: string }> =>
  (notes || "")
    .split("\n")
    .map((raw) => raw.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (/^#{1,6}\s/.test(line)) return { kind: "section" as const, text: line.replace(/^#{1,6}\s*/, "") };
      const item = line.replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
      return item.length ? { kind: "item" as const, text: item } : null;
    })
    .filter((entry): entry is { kind: "section" | "item"; text: string } => entry !== null);


/** 启动自动检查更新的提示弹窗：10 秒自动关闭，可直接下载并安装。 */
function AppUpdatePopup() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    void (async () => {
      try {
        const result = await checkAppUpdate();
        if (result?.hasUpdate) { setInfo(result); setCountdown(10); }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!info || busy) return;
    const timer = setInterval(() => setCountdown((value) => value - 1), 1000);
    return () => clearInterval(timer);
  }, [info, busy]);

  useEffect(() => {
    if (info && !busy && countdown <= 0) setInfo(null);
  }, [info, busy, countdown]);

  if (!info) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) setInfo(null); }}>
      <View style={styles.updateBackdrop}>
        <View style={styles.updateCard}>
          <Text style={styles.updateTitle}>发现新版本 {info.latestVersion}</Text>
          {busy ? <Text style={styles.updateHint}>{progress || "正在下载…"}</Text> : null}
          <ScrollView style={styles.updateNotesScroll} nestedScrollEnabled>
            {parseUpdateNotes(info.notes).map((line, index) =>
              line.kind === "section" ? (
                <Text key={index} style={styles.updateNoteSection}>{line.text}</Text>
              ) : (
                <View key={index} style={styles.updateNoteRow}>
                  <Text style={styles.updateNoteBullet}>·</Text>
                  <Text style={styles.updateNoteText}>{line.text}</Text>
                </View>
              ),
            )}
          </ScrollView>
          <View style={styles.updateActions}>
            <Pressable disabled={busy} onPress={() => setInfo(null)} style={styles.updateLater}>
              <Text style={styles.updateLaterText}>稍后</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => void Linking.openURL(info.releaseUrl)} style={styles.updateDetail}>
              <Text style={styles.updateDetailText}>查看详情</Text>
            </Pressable>
            <Pressable
              disabled={busy || !info.apkUrl}
              onPress={() => {
                void (async () => {
                  if (!info.apkUrl) return;
                  setBusy(true);
                  try {
                    await downloadAndInstallUpdate(info.apkUrl, setProgress);
                    setInfo(null);
                  } catch (updateError) {
                    setProgress(updateError instanceof Error ? updateError.message : String(updateError));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              style={[styles.updateNow, busy && styles.updateNowBusy]}
            >
              <Text style={styles.updateNowText}>{busy ? "更新中…" : "立即更新"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
