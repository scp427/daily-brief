/**
 * 从已生成的 `DailyReport` 裁剪出推送用的概览，不再调用 LLM。
 */

import type { DailyReport } from "../ai/pipeline";
import { categories, categoryLabel } from "../categories";
import type { NotifyConfig } from "./config";
import type { NotifySummary } from "./types";

export function buildNotifySummary(
  date: string,
  report: DailyReport,
  config: Pick<NotifyConfig, "maxBullets" | "baseUrl">,
): NotifySummary {
  const label = (category: { labelZh: string; labelEn: string }): string =>
    process.env.REPORT_LOCALE === "en" ? category.labelEn : category.labelZh;

  const bullets: string[] = [];
  for (const category of categories) {
    if (bullets.length >= config.maxBullets) break;
    const first = report.briefs[category.id]?.[0];
    if (first) bullets.push(`${label(category)}：${first.title}`);
  }

  const sections = (report.overview_sections ?? [])
    .filter((section) => section.text.trim().length > 0)
    .map((section) => ({
      label: categoryLabel(section.category),
      text: section.text.trim(),
    }));

  const trading = report.trading?.market_overview.trim();
  return {
    date,
    headline: report.hero_headline,
    overview: report.daily_overview,
    ...(sections.length > 0 ? { sections } : {}),
    bullets,
    trading: trading ? trading : undefined,
    url: config.baseUrl === "" ? undefined : `${config.baseUrl}/${date}/${date}.html`,
  };
}
