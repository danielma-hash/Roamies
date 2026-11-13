export interface PronunciationEntry {
  readonly term: string;
  readonly replacement: string;
}

export interface PronunciationDictionaryOptions {
  readonly filePath: string;
}

export interface PronunciationPreview {
  readonly before: string;
  readonly after: string;
}
