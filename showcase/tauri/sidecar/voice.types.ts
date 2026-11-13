export interface SpeechMessage {
  readonly kind: 'speech';
  readonly id?: string;
  readonly rate?: number;
  readonly pcm?: string;
  readonly end?: boolean;
  readonly stop?: boolean;
  readonly chars?: number;
}

export interface SpokenTurn {
  readonly id: string;
  say(text: string): void;
  beat(): boolean;
  end(): void;
  abort(): void;
}

export interface SpeakerOptions {
  readonly emit: (message: SpeechMessage) => void;
  readonly onProblem?: (reason: string) => void;
  readonly log?: (kind: string, data: Readonly<Record<string, unknown>>) => void;
  readonly fetchImpl?: typeof fetch;
}

export interface RecognitionCallbacks {
  readonly onText: (text: string) => void;
  readonly onDone: () => void;
  readonly onError: (error: Error) => void;
}
