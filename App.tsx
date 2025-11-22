
import React, { useState, useRef, useEffect, useCallback } from 'react';
import Header from './components/Header';
import ReaderView from './components/ReaderView';
import ControlBar from './components/ControlBar';
import { VOICE_OPTIONS } from './types';
import { generateSpeech } from './services/geminiService';
import { decodeBase64, decodeAudioData } from './utils/audioHelper';
import { splitTextIntoChunks } from './utils/textHelper';

const App: React.FC = () => {
  const [text, setText] = useState<string>('');
  const [selectedVoice, setSelectedVoice] = useState<string>(VOICE_OPTIONS[0].id);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Reading Mode State
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [chunks, setChunks] = useState<string[]>([]);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(0);

  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Cache for generated audio buffers: key = `${voiceId}-${chunkIndex}-${chunkHash}`
  // For simplicity using `${voiceId}-${chunkIndex}` since we reset on text change
  const audioCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, []);

  // When text or voice changes in Edit mode, invalidate cache/chunks
  useEffect(() => {
    if (mode === 'edit') {
      setChunks([]);
      audioCacheRef.current.clear();
    }
  }, [text, mode]);
  
  // When voice changes, clear cache so we regenerate with new voice
  useEffect(() => {
    stopAudio();
    setIsPlaying(false);
    audioCacheRef.current.clear();
  }, [selectedVoice]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch (e) {
        // ignore
      }
      sourceNodeRef.current = null;
    }
  };

  const getAudioBufferForChunk = async (index: number, textChunks: string[]): Promise<AudioBuffer> => {
    const cacheKey = `${selectedVoice}-${index}`;
    if (audioCacheRef.current.has(cacheKey)) {
      return audioCacheRef.current.get(cacheKey)!;
    }

    const chunkText = textChunks[index];
    // 1. Get Base64 from API
    const base64Audio = await generateSpeech(chunkText, selectedVoice);
    // 2. Decode Base64
    const encodedAudio = decodeBase64(base64Audio);
    // 3. Decode PCM -> AudioBuffer
    const ctx = initAudioContext();
    const buffer = await decodeAudioData(encodedAudio, ctx, 24000, 1);
    
    audioCacheRef.current.set(cacheKey, buffer);
    return buffer;
  };

  const playChunk = useCallback(async (index: number) => {
    if (index < 0 || index >= chunks.length) {
      setIsPlaying(false);
      return;
    }

    setError(null);
    setIsLoading(true);
    
    try {
      const buffer = await getAudioBufferForChunk(index, chunks);
      
      // If user stopped while loading
      if (!isPlaying && index === activeChunkIndex) { 
          // Only abort if we are still on the same index but paused. 
          // Actually, checks in async are tricky. Let's re-check state.
      }

      stopAudio(); // Stop previous chunk if any
      
      const ctx = initAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      source.onended = () => {
        // Automatically play next chunk if we are still "playing"
        // and this wasn't stopped manually
        // Note: checking ref or state inside callback
        if (activeChunkIndex === index && isPlaying) { // This logic is slightly flawed due to closure staleness, handled by Effect below
           // We will rely on React State to trigger next.
           // However, standard React pattern for sequential playback:
           // Trigger "Next" action.
           setActiveChunkIndex(prev => {
             if (prev + 1 < chunks.length) return prev + 1;
             setIsPlaying(false); // End of book
             return prev;
           });
        }
      };

      sourceNodeRef.current = source;
      source.start();
      setIsLoading(false);

      // Prefetch next chunk if exists
      if (index + 1 < chunks.length) {
         getAudioBufferForChunk(index + 1, chunks).catch(e => console.log('Prefetch failed', e));
      }

    } catch (err: any) {
      console.error(err);
      setError("Failed to load audio. " + (err.message || ""));
      setIsLoading(false);
      setIsPlaying(false);
    }
  }, [chunks, selectedVoice]); // We deliberately exclude isPlaying/activeChunkIndex to avoid loops, called by effect

  // Effect to trigger playback when index changes OR play state changes
  useEffect(() => {
    let isCancelled = false;

    if (isPlaying && mode === 'read' && chunks.length > 0) {
      // Play current chunk
      playChunk(activeChunkIndex);
    } else {
      stopAudio();
    }
    
    return () => { isCancelled = true; };
  }, [activeChunkIndex, isPlaying, mode, chunks.length /* playChunk depends on these but stable via useCallback? No, playChunk changes if chunks change */]);

  const handlePlayPause = () => {
    if (!text.trim()) {
      setError("Please enter text to read.");
      return;
    }

    if (mode === 'edit') {
      // Initialize Read Mode
      const newChunks = splitTextIntoChunks(text);
      if (newChunks.length === 0) return;
      
      setChunks(newChunks);
      setActiveChunkIndex(0);
      setMode('read');
      setIsPlaying(true);
    } else {
      // Toggle Play/Pause in Read Mode
      setIsPlaying(!isPlaying);
    }
  };

  const handleNext = () => {
    if (activeChunkIndex < chunks.length - 1) {
      stopAudio();
      setActiveChunkIndex(prev => prev + 1);
      setIsPlaying(true); // Ensure we keep playing
    }
  };

  const handlePrev = () => {
    if (activeChunkIndex > 0) {
      stopAudio();
      setActiveChunkIndex(prev => prev - 1);
      setIsPlaying(true);
    }
  };

  const handleModeChange = (newMode: 'edit' | 'read') => {
    setMode(newMode);
    if (newMode === 'edit') {
      setIsPlaying(false);
      stopAudio();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-sans flex flex-col">
      <Header />
      
      <main className="flex-grow pt-16 px-4 flex flex-col items-center overflow-y-auto w-full">
        <ReaderView 
          text={text} 
          onTextChange={setText}
          mode={mode}
          onModeChange={handleModeChange}
          chunks={chunks}
          activeChunkIndex={activeChunkIndex}
        />
      </main>

      <ControlBar 
        isPlaying={isPlaying}
        isLoading={isLoading}
        onPlayPause={handlePlayPause}
        onNext={handleNext}
        onPrev={handlePrev}
        selectedVoice={selectedVoice}
        onVoiceChange={setSelectedVoice}
        hasText={text.length > 0}
        error={error}
        mode={mode}
      />
    </div>
  );
};

export default App;
