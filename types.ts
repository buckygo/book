export interface VoiceOption {
  name: string;
  id: string;
  gender: 'Male' | 'Female';
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { name: 'Puck', id: 'Puck', gender: 'Male' },
  { name: 'Charon', id: 'Charon', gender: 'Male' },
  { name: 'Kore', id: 'Kore', gender: 'Female' },
  { name: 'Fenrir', id: 'Fenrir', gender: 'Male' },
  { name: 'Zephyr', id: 'Zephyr', gender: 'Female' },
];

export interface AudioState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  duration: number;
  currentTime: number;
}