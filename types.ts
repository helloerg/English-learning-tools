
export interface WordDetail {
  word: string;
  phonetic: string;
  definitions: { en: string; zh: string }[];
  examples: { en: string; zh: string }[];
}

export interface VocabularyWord extends WordDetail {
  addedAt: number;
  lastPracticedAt?: number;
}

export interface UserGoals {
  dailyNewWords: number;
  dailyReviews: number;
}

export interface LearningSession {
  id: string;
  originalImage?: string;
  extractedText: string;
  words: WordDetail[];
  userTranslation: string;
  aiTranslation: string;
  aiComparison: string;
  createdAt: number;
  nextReviewAt: number;
  reviewCount: number;
  lastNotifiedAt?: number; 
  lastReviewedAt?: number; // New field to track when this session was last reviewed
}

export enum AppStage {
  IDLE = 'IDLE',
  CAPTURE = 'CAPTURE',
  OCR_RESULT = 'OCR_RESULT',
  WORD_BREAKDOWN = 'WORD_BREAKDOWN',
  USER_THINKING = 'USER_THINKING',
  COMPARISON = 'COMPARISON',
  REVIEW_CENTER = 'REVIEW_CENTER',
  VOCABULARY = 'VOCABULARY',
  WORD_PRACTICE = 'WORD_PRACTICE',
  FEEDBACK = 'FEEDBACK',
  GOALS = 'GOALS'
}

export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30]; // Days
