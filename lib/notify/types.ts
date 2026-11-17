/**
 * 通知链路的数据契约。
 *
 * 渠道实现只消费 `NotifySummary`，不读 `DailyReport`——报告结构变化时
 * 需要改的只有 `summary.ts`。
 */
export interface NotifySummary {
  date: string;
  headline: string;
  overview: string;
  /** 按大分类展开的总览段落；旧报告没有该结构时为空。 */
  sections?: Array<{ label: string; text: string }>;
  /** 每个分类取一条，形如「技术动态：标题」；有 sections 时渠道可省略。 */
  bullets: string[];
  /** 交易日点评的首段；当日没有行情板块时为空。 */
  trading?: string;
  /** 完整报告的公开链接；`baseUrl` 未配置时为空。 */
  url?: string;
}

export interface NotifyChannel {
  id: string;
  send(summary: NotifySummary): Promise<void>;
}
