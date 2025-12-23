
export interface AnalysisResult {
  accuracyScore: number;
  transcription: string;
  mispronouncedWords: string[];
  feedback: string;
  tips: string;
  isPerfect: boolean;
}

export interface SavedPhrase {
  id: string;
  text: string;
  note: string;
  timestamp: number;
  lastScore?: number;
  practiceCount?: number;
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface ExerciseState {
  currentPhraseIndex: number;
  shuffledPhrases: SavedPhrase[];
  step: 'WRITING' | 'SPEAKING' | 'RESULT' | 'FINISHED';
  userInput: string;
  writingResult?: {
    score: number;
    diff: { word: string; isCorrect: boolean }[];
  };
}

export enum AppStatus {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  ANALYZING = 'ANALYZING',
  RESULT = 'RESULT',
  ERROR = 'ERROR',
  EXERCISE = 'EXERCISE'
}
