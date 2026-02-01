import React, { useEffect, useRef, useState, useCallback } from 'react';
import { VisionResponse, AppConfig, WSMessage } from '../types';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { AlertTriangle, Wifi, WifiOff, Mic, MicOff, UserPlus } from 'lucide-react';

interface CameraViewProps {
  config: AppConfig;
  isActive: boolean;
}

const CameraView: React.FC<CameraViewProps> = ({ config, isActive }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { speak } = useTextToSpeech();
  const { isListening, transcript, startListening, setTranscript } = useSpeechRecognition();
  
  const [isConnected, setIsConnected] = useState(false);
  const [lastResponse, setLastResponse] = useState<VisionResponse | null>(null);
  const [hasPerson, setHasPerson] = useState(false);

  // Initialize Camera
  useEffect(() => {
    const startCamera = async () => {
      if (isActive && videoRef.current) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment', // Use back camera
              width: { ideal: 640 },
              height: { ideal: 480 }
            },
            audio: false,
          });
          videoRef.current.srcObject = stream;
        } catch (err) {
          console.error("Camera access denied:", err);
          speak("Camera access denied. Please check permissions.");
        }
      }
    };

    if (isActive) {
      startCamera();
    } else {
      // Stop tracks
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    }
  }, [isActive, speak]);

  // Handle WebSocket Connection
  useEffect(() => {
    if (!isActive || config.simulationMode) return;

    const connectWs = () => {
      const ws = new WebSocket(config.serverUrl);

      ws.onopen = () => {
        setIsConnected(true);
        speak("Connected to Vision Server.");
      };

      ws.onclose = () => {
        setIsConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const data: VisionResponse = JSON.parse(event.data);
          setLastResponse(data);
          
          // Check for person to enable face ID hints (but exclude if already identified)
          const personDetected = data.objects.some(obj => obj.label.toLowerCase() === 'person');
          setHasPerson(personDetected);

          if (data.is_obstacle) {
             // Haptic feedback for obstacles (Accessibility)
             if (navigator.vibrate) {
                 navigator.vibrate(200);
             }
          }

          if (data.command) {
            // Priority handling for "Stop" commands
            const isPriority = data.command.toLowerCase().includes('stop');
            speak(data.command, isPriority);
          }
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };

      wsRef.current = ws;
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isActive, config.serverUrl, config.simulationMode, speak]);

  // Handle Voice Commands
  useEffect(() => {
    if (transcript && isActive) {
      // Send command to backend
      if (config.simulationMode) {
        speak(`I heard: ${transcript}. Simulation mode cannot process commands.`);
      } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSMessage = { type: 'command', data: transcript };
        wsRef.current.send(JSON.stringify(msg));
        // Reset transcript after sending
        setTranscript('');
      }
    }
  }, [transcript, isActive, config.simulationMode, speak, setTranscript]);

  // Frame Processing Loop
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      captureAndSend();
    }, config.frameRate);

    return () => clearInterval(interval);
  }, [isActive, config, isConnected]);

  const captureAndSend = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (config.simulationMode) {
        simulateResponse();
      } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // Send to backend as JSON
        const base64 = canvas.toDataURL('image/jpeg', 0.5); 
        const msg: WSMessage = { type: 'image', data: base64 };
        wsRef.current.send(JSON.stringify(msg));
      }
    }
  }, [config.simulationMode]);

  // Simulation Helper
  const simulateResponse = () => {
    // Mock logic to demonstrate UI without backend
    const rnd = Math.random();
    let mockResponse: VisionResponse;

    if (rnd > 0.8) {
      mockResponse = {
        command: "Stop. Chair directly ahead.",
        free_space_percentage: 10,
        is_obstacle: true,
        objects: [{ label: 'chair', confidence: 0.9, bbox: [0.3, 0.3, 0.4, 0.6], distance_category: 'immediate' }]
      };
    } else if (rnd > 0.5) {
      mockResponse = {
        command: "Person detected on left.",
        free_space_percentage: 60,
        is_obstacle: false,
        objects: [{ label: 'person', confidence: 0.85, bbox: [0.1, 0.2, 0.2, 0.7], distance_category: 'near' }]
      };
    } else {
      mockResponse = {
        command: "Path clear.",
        free_space_percentage: 90,
        is_obstacle: false,
        objects: []
      };
    }
    
    setLastResponse(mockResponse);
    setHasPerson(mockResponse.objects.some(o => o.label.includes('person')));

    if (mockResponse.command !== "Path clear.") {
        speak(mockResponse.command, mockResponse.is_obstacle);
        if (mockResponse.is_obstacle && navigator.vibrate) {
            navigator.vibrate(200);
        }
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center bg-black">
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Main Video Feed */}
      <div className={`relative w-full h-64 md:h-96 bg-gray-900 overflow-hidden border-b-8 ${lastResponse?.is_obstacle ? 'border-red-600' : 'border-yellow-400'}`}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        
        {/* Connection Status Indicator */}
        <div className={`absolute top-4 right-4 p-2 rounded-full ${isConnected || config.simulationMode ? 'bg-green-600' : 'bg-red-600'}`}>
           {isConnected || config.simulationMode ? <Wifi className="w-8 h-8 text-white" /> : <WifiOff className="w-8 h-8 text-white" />}
        </div>

        {/* Bounding Box Overlay */}
        {lastResponse?.objects.map((obj, idx) => (
          <div
            key={idx}
            className={`absolute border-4 ${obj.distance_category === 'immediate' ? 'border-red-600' : 'border-yellow-500'}`}
            style={{
              left: `${obj.bbox[0] * 100}%`,
              top: `${obj.bbox[1] * 100}%`,
              width: `${obj.bbox[2] * 100}%`,
              height: `${obj.bbox[3] * 100}%`,
            }}
          >
            <span className="absolute -top-10 left-0 bg-black text-white font-bold px-3 py-1 text-lg border-2 border-yellow-500">
              {obj.label}
            </span>
          </div>
        ))}

        {!isActive && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <p className="text-gray-400 text-2xl font-bold">Camera Paused</p>
           </div>
        )}
      </div>

      {/* Large Accessibility Text Output */}
      <div className="flex-1 w-full p-6 flex flex-col items-center justify-center text-center space-y-6">
        <div className={`text-6xl font-extrabold tracking-tight ${lastResponse?.is_obstacle ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
          {lastResponse?.command || "Ready..."}
        </div>

        {/* Free Space Indicator */}
        <div className="w-full max-w-md bg-gray-800 rounded-full h-12 overflow-hidden border-4 border-white">
          <div 
            className={`h-full transition-all duration-300 ${lastResponse?.is_obstacle ? 'bg-red-600' : 'bg-green-500'}`}
            style={{ width: `${lastResponse?.free_space_percentage || 100}%` }} 
          />
        </div>

        {/* Dynamic Contextual Hint for Face ID */}
        {hasPerson && (
           <div className="bg-blue-900/50 border-2 border-blue-400 p-4 rounded-xl flex items-center space-x-3 animate-pulse">
              <UserPlus className="w-8 h-8 text-blue-300" />
              <p className="text-lg font-semibold text-blue-100">Person detected. Say "Remember this person as [Name]"</p>
           </div>
        )}
        
        {/* Voice Command UI */}
        <div className="w-full flex justify-center mt-4">
          <button
            onClick={startListening}
            disabled={isListening || !isActive}
            className={`
              flex items-center space-x-3 px-10 py-6 rounded-full font-bold text-2xl transition-all shadow-lg
              ${isListening 
                ? 'bg-red-600 animate-pulse text-white ring-4 ring-red-400' 
                : 'bg-blue-600 hover:bg-blue-500 text-white'}
              ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
             {isListening ? <Mic className="w-10 h-10" /> : <MicOff className="w-10 h-10" />}
             <span>{isListening ? "Listening..." : "Voice Command"}</span>
          </button>
        </div>
      </div>

      {/* Debug Info */}
      <div className="w-full p-2 bg-gray-900 text-sm text-gray-400 font-mono text-center">
        Status: {isActive ? 'Active' : 'Idle'} | Mode: {config.simulationMode ? 'Sim' : 'Live'} | Cmd: {transcript}
      </div>
    </div>
  );
};

export default CameraView;