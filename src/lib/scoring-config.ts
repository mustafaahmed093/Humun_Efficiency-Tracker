/** Rule weights and pace targets for the rule-based daily scores. */
export const SCORING_CONFIG = {
  business: { blockCompletion: 0.5, leadPace: 0.5 },
  leadTargetsPerDay: { outbound: 20, medspa: 37, linkedinOutreach: 15 },
  health: { exercise: 30, sleep: 40, meals: 15, walkOrMeditation: 15, mealsForFullCredit: 3, sleepTargetHours: 8 },
  mental: { mood: 1 / 3, stress: 1 / 3, overthinking: 1 / 3, overthinkingZeroScoreAt: 5, missingAnswerNeutralScore: 60 },
  focus: { selfRating: 0.5, deepWorkCompletion: 0.5, ratingScaleMax: 10 },
  overall: { business: 0.25, health: 0.2, mental: 0.2, focus: 0.2, religious: 0.15 },
  religious: { prayers: 70, nightlyLecture: 20, fajrAndYaseen: 10 },
  trendThreshold: 5,
  planGoals: { outboundLeads: 300, medspaLeads: 560, medspaClients: 1, startupProgress: 100, sleepHours: 8 },
} as const;
