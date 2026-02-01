import { useState, useCallback, useEffect, useRef } from 'react';

export const useTextToSpeech = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const synth = useRef<SpeechSynthesis | null>(null);
  const lastSpokenRef = useRef<string>('');
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      synth.current = window.speechSynthesis;
    }
  }, []);

  const speak = useCallback((text: string, force: boolean = false) => {
    if (!synth.current) return;

    // Avoid repeating the exact same phrase too quickly unless forced (e.g., "Stop")
    if (!force && text === lastSpokenRef.current && synth.current.speaking) {
      return;
    }

    // "Stop" commands should interrupt everything
    if (text.toLowerCase().includes('stop') || force) {
      synth.current.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1; // Slightly faster for real-time feedback
    utterance.pitch = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    
    lastSpokenRef.current = text;
    synth.current.speak(utterance);
  }, []);

  const cancel = useCallback(() => {
    if (synth.current) {
      synth.current.cancel();
      setIsSpeaking(false);
    }
  }, []);

  return { speak, cancel, isSpeaking };
};