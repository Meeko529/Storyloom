import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AdaptiveScroll } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";
import type {
  AgentClarificationAnswer,
  AgentClarificationRequest,
  AgentRunTrace,
  AgentTraceEvent,
  AgentTraceEventKind,
  AgentTraceEventStatus,
} from "@/types";

type IconName = ComponentProps<typeof Ionicons>["name"];

function eventIcon(kind: AgentTraceEventKind): IconName {
  if (kind === "agent") return "people-outline";
  if (kind === "skill") return "extension-puzzle-outline";
  if (kind === "question") return "help-circle-outline";
  if (kind === "consistency") return "sync-outline";
  return "construct-outline";
}

function statusIcon(status: AgentTraceEventStatus): IconName {
  if (status === "completed") return "checkmark-circle";
  if (status === "error") return "alert-circle";
  if (status === "waiting") return "time-outline";
  return "ellipse-outline";
}

function statusColor(status: AgentTraceEventStatus): string {
  if (status === "error") return colors.danger;
  if (status === "waiting") return colors.accent;
  return colors.primary;
}

function runStatus(trace: AgentRunTrace): { label: string; color: string } {
  if (trace.status === "error") return { label: "执行失败", color: colors.danger };
  if (trace.events.some((event) => event.status === "waiting")) return { label: "等待你的操作", color: colors.accent };
  if (trace.status === "running") return { label: "正在协作", color: colors.primary };
  return { label: "已完成", color: colors.primary };
}

/**
 * 组头摘要：只写「工具名 + 次数」的聚合。
 *
 * 刻意不写智能体名、不写"N 个智能体 / N 项工具 / N 个技能 / 已探索 N 项 / N 次提问"这类总数 ——
 * 展开后每一行都写着这些，组头再写一遍就是重复。总时长也只在这里出现一次。
 */
function summarizeTools(trace: AgentRunTrace): string {
  const counts = new Map<string, number>();
  for (const event of trace.events) {
    if (event.kind !== "tool" && event.kind !== "consistency") continue;
    const name = event.title.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join("、");
}

function EventPayload({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.payload}>
      <Text style={styles.payloadLabel}>{label}</Text>
      <Text selectable style={styles.payloadText}>{value}</Text>
    </View>
  );
}

function TraceEventRow({ event, inline = false }: { event: AgentTraceEvent; inline?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = Boolean(event.input || event.output);
  return (
    <View style={[styles.event, inline && styles.eventInline]}>
      <Pressable
        accessibilityRole={hasPayload ? "button" : undefined}
        accessibilityState={hasPayload ? { expanded } : undefined}
        disabled={!hasPayload}
        onPress={() => setExpanded((value) => !value)}
        style={styles.eventHeader}
      >
        <View style={styles.eventKindIcon}>
          <Ionicons name={eventIcon(event.kind)} size={15} color={colors.textMuted} />
        </View>
        <View style={styles.eventCopy}>
          <View style={styles.eventTitleLine}>
            <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
            {event.agentName ? <Text style={styles.agentName} numberOfLines={1}>{event.agentName}</Text> : null}
          </View>
          {event.detail ? <Text style={styles.eventDetail} numberOfLines={expanded ? undefined : 2}>{event.detail}</Text> : null}
        </View>
        {event.status === "running" ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name={statusIcon(event.status)} size={19} color={statusColor(event.status)} />
        )}
        {hasPayload ? (
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={17} color={colors.textMuted} />
        ) : null}
      </Pressable>
      {expanded ? (
        <View style={styles.payloads}>
          {event.input ? <EventPayload label="输入" value={event.input} /> : null}
          {event.output ? <EventPayload label="结果" value={event.output} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * 时间线里的一段思考。
 *
 * 组内的一段，不是独立折叠：没有自己的箭头，展开由外层那个合集统一控制。
 * 「用时」也不在这里写 —— 总时长由组头承担，重复写就是冗余。
 */
export function ReasoningSegment({ text, seconds, live }: { text: string; seconds?: number; live?: boolean }) {
  return (
    <View style={styles.reasoningSegment}>
      <View style={styles.reasoningSegmentHeader}>
        <Ionicons name="bulb-outline" size={15} color={live ? colors.primary : colors.textMuted} />
        <Text style={[styles.reasoningSegmentTitle, live && styles.reasoningSegmentTitleLive]}>
          {live ? "思考中" : "思考过程"}
        </Text>
        {seconds ? <Text style={styles.reasoningSegmentMeta}>用时 {seconds}s</Text> : null}
        <Text style={styles.reasoningSegmentMeta}>{text.trim().length} 字</Text>
      </View>
      <View style={styles.reasoningSegmentBody}>
        <Text selectable style={styles.reasoningSegmentText}>{text}</Text>
      </View>
    </View>
  );
}

/**
 * 一轮回复 = 一个合集。
 *
 * 结构照 open-webui 的 ConsecutiveDetailsGroup：一个折叠、一个箭头，组内所有内容
 * 一起展开收起，段落自身不再各带箭头。展开后是一条按真实顺序排下来的线 ——
 * 思考与工具事件混在里面，不写死谁在前。
 *
 * 组头只写「状态 + 工具名聚合 + 总时长」三样：智能体名与各类总数一律不进组头，
 * 因为展开后每行都写着，组头再写一遍就是重复。
 */
export function AgentTraceView({
  trace,
  defaultExpanded = false,
  durationSeconds,
  inline = false,
  reasoningSegments,
  liveReasoning,
}: {
  trace: AgentRunTrace;
  defaultExpanded?: boolean;
  /** 本轮总耗时（秒）：完成态在组头追加一次，组内不再重复。 */
  durationSeconds?: number;
  /** 时间线形态：不画卡片外框与底色，组直接铺在消息/实时时间线里。 */
  inline?: boolean;
  /** 全部思考段落，按真实顺序；旧数据可回落到单个 reasoning 文本 */
  reasoningSegments?: Array<{ text: string; seconds?: number; live?: boolean }>;
  /** 实时流式思考：尚未进入 segments，先挂在组末 */
  liveReasoning?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || trace.status === "running");
  const status = runStatus(trace);
  const toolSummary = useMemo(() => summarizeTools(trace), [trace]);

  useEffect(() => {
    if (trace.status === "running") setExpanded(true);
  }, [trace.status]);

  // 段落的唯一来源：有 segments 就按它排；旧数据没有 segments 时把思考放最前兜底。
  const eventsById = useMemo(() => new Map(trace.events.map((event) => [event.id, event])), [trace.events]);
  const lines = useMemo(() => {
    const collected: Array<{ kind: "reasoning"; text: string; seconds?: number; live?: boolean }
      | { kind: "event"; id: string }> = [];
    if (trace.segments?.length) {
      for (const segment of trace.segments) {
        if (segment.kind === "reasoning") {
          if (segment.text.trim()) collected.push({ kind: "reasoning", text: segment.text, seconds: segment.seconds });
        } else if (eventsById.has(segment.eventId)) {
          collected.push({ kind: "event", id: segment.eventId });
        }
      }
    } else {
      for (const segment of reasoningSegments ?? []) {
        if (segment.text.trim()) collected.push({ kind: "reasoning", text: segment.text, seconds: segment.seconds });
      }
      for (const event of trace.events) collected.push({ kind: "event", id: event.id });
    }
    if (liveReasoning?.trim()) collected.push({ kind: "reasoning", text: liveReasoning, live: true });
    return collected;
  }, [trace.segments, trace.events, eventsById, reasoningSegments, liveReasoning]);

  return (
    <View style={styles.trace}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? "收起处理过程" : "展开处理过程"}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.traceHeader, inline && styles.traceHeaderInline]}
      >
        <View style={styles.traceIcon}>
          <Ionicons name="git-network-outline" size={15} color={status.color} />
        </View>
        <Text style={[styles.traceStatus, { color: status.color }]}>{status.label}</Text>
        {toolSummary ? <Text style={styles.traceTools} numberOfLines={1}>{toolSummary}</Text> : null}
        {durationSeconds ? <Text style={styles.traceElapsed}>用时 {durationSeconds}s</Text> : null}
        {trace.status === "running" ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
      </Pressable>
      {expanded && lines.length ? (
        <AdaptiveScroll maxHeight={340} claimGesture>
          {/* claimGesture：助手消息列表是 inverted FlatList，思考轨迹嵌在列表头里。
              不抢手势的话，想上下滑看轨迹内容时整条对话会先跟着滑走。 */}
          <View style={styles.events}>
            {trace.collaborationRequired ? (
              <View style={styles.collaborationNotice}>
                <Ionicons name="people-outline" size={16} color={colors.primary} />
                <Text style={styles.collaborationText}>此任务可按需调用专业子智能体协作</Text>
              </View>
            ) : null}
            {lines.map((line, index) => {
              if (line.kind === "reasoning") {
                return <ReasoningSegment key={`reasoning-${index}`} text={line.text} seconds={line.seconds} live={line.live} />;
              }
              const event = eventsById.get(line.id);
              return event ? <TraceEventRow key={event.id} event={event} inline={inline} /> : null;
            })}
          </View>
        </AdaptiveScroll>
      ) : null}
    </View>
  );
}

type QuestionAnswerState = Record<number, string>;
type CustomAnswerState = Record<number, boolean>;

export function AgentQuestionSheet({
  request,
  onSubmit,
  onCancel,
}: {
  request: AgentClarificationRequest | null;
  onSubmit: (answers: AgentClarificationAnswer[]) => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<QuestionAnswerState>({});
  const [customAnswers, setCustomAnswers] = useState<CustomAnswerState>({});

  useEffect(() => {
    setAnswers({});
    setCustomAnswers({});
  }, [request?.id]);

  if (!request) return null;

  const canSubmit = request.questions.every((_, index) => Boolean(answers[index]?.trim()));
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(request.questions.map((question, index) => ({
      question: question.title,
      answer: answers[index].trim(),
    })));
  };

  return (
    <View style={styles.questionBackdrop}>
        <View style={styles.questionSheet}>
          <View style={styles.questionHeader}>
            <View style={styles.questionHeaderIcon}>
              <Ionicons name="help-circle-outline" size={21} color={colors.primary} />
            </View>
            <View style={styles.questionHeaderCopy}>
              <Text style={styles.questionSheetTitle}>{request.agentName} 需要你的选择 · {request.questions.length} 个问题</Text>
            </View>
            <Pressable accessibilityLabel="稍后回答" onPress={onCancel} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          {/* claimGesture 同上：提问卡嵌在倒置列表里，不抢手势则滑动被外层吃掉。 */}
          <AdaptiveScroll maxHeight={300} contentContainerStyle={styles.questions} keyboardShouldPersistTaps="handled" claimGesture>
            {request.questions.map((question, questionIndex) => (
              <View key={`${request.id}-${questionIndex}`} style={styles.question}>
                <Text style={styles.questionIndex}>问题 {questionIndex + 1}</Text>
                <Text style={styles.questionTitle}>{question.title}</Text>
                {question.description ? <Text style={styles.questionDescription}>{question.description}</Text> : null}
                <View accessibilityRole="radiogroup" style={styles.options}>
                  {question.options.map((option, optionIndex) => {
                    const selected = !customAnswers[questionIndex] && answers[questionIndex] === option.label;
                    return (
                      <Pressable
                        key={`${option.label}-${optionIndex}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        onPress={() => {
                          setCustomAnswers((current) => ({ ...current, [questionIndex]: false }));
                          setAnswers((current) => ({ ...current, [questionIndex]: option.label }));
                        }}
                        style={[styles.option, selected && styles.optionSelected]}
                      >
                        <Ionicons
                          name={selected ? "radio-button-on" : "radio-button-off"}
                          size={20}
                          color={selected ? colors.primary : colors.textMuted}
                        />
                        <View style={styles.optionCopy}>
                          <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{option.label}</Text>
                          {option.description ? <Text style={styles.optionDescription}>{option.description}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: Boolean(customAnswers[questionIndex]) }}
                    onPress={() => {
                      setCustomAnswers((current) => ({ ...current, [questionIndex]: true }));
                      setAnswers((current) => ({ ...current, [questionIndex]: "" }));
                    }}
                    style={[styles.option, customAnswers[questionIndex] && styles.optionSelected]}
                  >
                    <Ionicons
                      name={customAnswers[questionIndex] ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={customAnswers[questionIndex] ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.optionLabel, customAnswers[questionIndex] && styles.optionLabelSelected]}>
                      自行输入答案
                    </Text>
                  </Pressable>
                  {customAnswers[questionIndex] ? (
                    <TextInput
                      autoFocus
                      multiline
                      maxLength={1200}
                      onChangeText={(value) => setAnswers((current) => ({ ...current, [questionIndex]: value }))}
                      placeholder="输入你的决定或补充"
                      placeholderTextColor={colors.textMuted}
                      style={styles.customInput}
                      value={answers[questionIndex] ?? ""}
                    />
                  ) : null}
                </View>
              </View>
            ))}
          </AdaptiveScroll>
          <View style={styles.questionActions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.questionButtonSecondary}>
              <Text style={styles.questionButtonSecondaryText}>稍后再说</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={submit}
              style={[styles.questionButtonPrimary, !canSubmit && styles.questionButtonDisabled]}
            >
              <Text style={styles.questionButtonPrimaryText}>提交回答</Text>
            </Pressable>
          </View>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 组根：一个组一条线，不画外框与底色，状态行与后续轨迹直接落在消息/实时时间线上。
  trace: { alignSelf: "flex-start", flexShrink: 1, maxWidth: "88%" },
  traceInline: { borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
  traceHeaderInline: { paddingHorizontal: 0 },
  eventsInline: { borderTopWidth: 0 },
  traceHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  traceIcon: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  traceStatus: { fontSize: 13, fontWeight: "700" },
  // 组头的工具名聚合：flexShrink 让它可压缩，状态与时长不被挤掉。
  traceTools: { flexShrink: 1, minWidth: 0, color: colors.textMuted, fontSize: 12 },
  traceElapsed: { color: colors.textMuted, fontSize: 12 },
  events: {},
  collaborationNotice: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: "#E8F2EE",
  },
  collaborationText: { flex: 1, color: colors.primary, fontSize: 12, fontWeight: "600" },
  // 思考段：组内的一段，没有自己的折叠箭头；正文缩进一档并加左侧细竖线。
  reasoningSegment: { paddingHorizontal: 0 },
  reasoningSegmentHeader: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 },
  reasoningSegmentTitle: { color: colors.textMuted, fontSize: 13 },
  reasoningSegmentTitleLive: { color: colors.primary },
  reasoningSegmentMeta: { color: colors.textMuted, fontSize: 12 },
  reasoningSegmentText: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  reasoningSegmentBody: { marginTop: spacing.xs, marginLeft: 5, paddingLeft: spacing.sm, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  event: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  eventInline: { borderTopWidth: 0, borderTopColor: "transparent" },
  eventHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  eventKindIcon: { width: 22, alignItems: "center" },
  eventCopy: { flexShrink: 1, minWidth: 0 },
  eventTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eventTitle: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: "700" },
  agentName: { flexShrink: 1, color: colors.textMuted, fontSize: 11 },
  eventDetail: { marginTop: 3, color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  payloads: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  payload: { gap: spacing.xs, padding: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  payloadLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  payloadText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  questionBackdrop: { width: "100%", maxWidth: "88%", alignSelf: "flex-start" },
  questionSheet: {
    maxHeight: 400,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#EFF3F0",
    overflow: "hidden",
  },
  questionHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  questionHeaderIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  questionHeaderCopy: { flex: 1, minWidth: 0 },
  questionSheetTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  closeButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  questions: { padding: spacing.md, paddingBottom: spacing.lg, gap: spacing.lg },
  question: { gap: spacing.sm },
  questionIndex: { color: colors.primary, fontSize: 11, fontWeight: "700" },
  questionTitle: { color: colors.text, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  questionDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  options: { gap: spacing.sm, marginTop: spacing.xs },
  option: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  optionCopy: { flex: 1, minWidth: 0 },
  optionLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  optionLabelSelected: { color: colors.primary },
  optionDescription: { marginTop: 3, color: colors.textMuted, fontSize: 11.5, lineHeight: 16 },
  customInput: {
    minHeight: 88,
    maxHeight: 160,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: "top",
  },
  questionActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  questionButtonSecondary: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  questionButtonSecondaryText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  questionButtonPrimary: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  questionButtonDisabled: { opacity: 0.45 },
  questionButtonPrimaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  });
