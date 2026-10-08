import { SCORING_CONFIG } from "./scoring-config.ts";

export type DailyAnswers = {
  prayers?: Record<string, boolean | null>;
  dailyLecture?: boolean;
  outboundLeads?: number;
  outboundReplies?: number;
  outboundCalls?: number;
  medspaLeads?: number;
  medspaReplies?: number;
  medspaCalls?: number;
  medspaConverted?: number;
  medspaNotConverted?: number;
  medspaNotConvertedReason?: string;
  medspaClientsTotal?: number;
  linkedinSent?: number;
  linkedinInbound?: number;
  linkedinPosts?: number;
  startupProgress?: number;
  startupMoved?: string;
  mood?: "Sad" | "Guzara" | "Productive";
  stress?: "Nahi" | "Thoda" | "Zyada";
  overthinkingCount?: number;
  focusRating?: number;
  meals?: string[];
  sleepHours?: number;
  exerciseDone?: boolean;
  walkDone?: boolean;
};

export type Scores = { business: number; health: number; mental: number; focus: number; religious: number; overall: number };
export type ScoreBlock = { category: string; name: string; status?: "done" | "missed" | null };
const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));
const ratio = (n: number, target: number) => clamp((Math.max(0, n) / target) * 100);

export function calculateScores(answers: DailyAnswers, blocks: ScoreBlock[]): Scores {
  const done = (b: ScoreBlock) => b.status === "done";
  const businessBlocks = blocks.filter(b => b.category === "Business" || b.category === "Startup");
  const businessCompletion = businessBlocks.length ? businessBlocks.filter(done).length / businessBlocks.length * 100 : 0;
  const targets = SCORING_CONFIG.leadTargetsPerDay;
  const leadPace = [ratio(answers.outboundLeads ?? 0, targets.outbound), ratio(answers.medspaLeads ?? 0, targets.medspa), ratio(answers.linkedinSent ?? 0, targets.linkedinOutreach)].reduce((a, b) => a + b, 0) / 3;
  const business = Math.round(businessCompletion * SCORING_CONFIG.business.blockCompletion + leadPace * SCORING_CONFIG.business.leadPace);

  const exerciseBlock = blocks.find(b => b.name.toLowerCase().includes("exercise"));
  const walkBlock = blocks.find(b => b.name.toLowerCase().includes("meditation / walk"));
  const exercise = answers.exerciseDone ?? Boolean(exerciseBlock && done(exerciseBlock));
  const walk = answers.walkDone ?? Boolean(walkBlock && done(walkBlock));
  const healthWeights = SCORING_CONFIG.health;
  const meals = (answers.meals ?? []).filter(m => m.trim()).length;
  const health = Math.round((exercise ? healthWeights.exercise : 0) + clamp((answers.sleepHours ?? 0) / healthWeights.sleepTargetHours * 100) * healthWeights.sleep / 100 + Math.min(meals / healthWeights.mealsForFullCredit, 1) * healthWeights.meals + (walk ? healthWeights.walkOrMeditation : 0));

  const mood: Record<string, number> = { Productive: 100, Guzara: 60, Sad: 20 };
  const stress: Record<string, number> = { Nahi: 100, Thoda: 60, Zyada: 20 };
  const mentalWeights = SCORING_CONFIG.mental;
  const moodScore = mood[answers.mood ?? ""] ?? mentalWeights.missingAnswerNeutralScore;
  const stressScore = stress[answers.stress ?? ""] ?? mentalWeights.missingAnswerNeutralScore;
  const overthinking = answers.overthinkingCount === undefined ? mentalWeights.missingAnswerNeutralScore : clamp(100 - Math.max(0, answers.overthinkingCount) * (100 / mentalWeights.overthinkingZeroScoreAt));
  const mental = Math.round(moodScore * mentalWeights.mood + stressScore * mentalWeights.stress + overthinking * mentalWeights.overthinking);

  const deepWork = blocks.filter(b => {
    const name = b.name.toLowerCase();
    return name.includes("startup work") || name.includes("lead scrape") || name.includes("outreach");
  });
  const deepWorkCompletion = deepWork.length ? deepWork.filter(done).length / deepWork.length * 100 : 0;
  const focusWeights = SCORING_CONFIG.focus;
  const focus = Math.round(clamp((answers.focusRating ?? 0) * (100 / focusWeights.ratingScaleMax)) * focusWeights.selfRating + deepWorkCompletion * focusWeights.deepWorkCompletion);

  const prayerValues = Object.values(answers.prayers ?? {}).filter((v): v is boolean => typeof v === "boolean");
  const prayersDone = prayerValues.filter(Boolean).length;
  const fajrBlock = blocks.find(b => b.name.toLowerCase().includes("fajr: namaz + surah yaseen"));
  const lectureBlock = blocks.find(b => b.name.toLowerCase().includes("dr nauman ali khan lecture"));
  const religionWeights = SCORING_CONFIG.religious;
  const religious = Math.round((prayerValues.length ? prayersDone / 5 * religionWeights.prayers : 0) + ((answers.dailyLecture ?? Boolean(lectureBlock && done(lectureBlock))) ? religionWeights.nightlyLecture : 0) + (fajrBlock && done(fajrBlock) ? religionWeights.fajrAndYaseen : 0));
  const overallWeights = SCORING_CONFIG.overall;
  const overall = Math.round(business * overallWeights.business + health * overallWeights.health + mental * overallWeights.mental + focus * overallWeights.focus + religious * overallWeights.religious);
  return { business: clamp(business), health: clamp(health), mental: clamp(mental), focus: clamp(focus), religious: clamp(religious), overall: clamp(overall) };
}
