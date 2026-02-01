import React, { useState } from 'react';
import CameraView from './components/CameraView';
import { AppConfig } from './types';
import { Eye, Settings, PlayCircle, PauseCircle } from 'lucide-react';

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Default Configuration
  const [config, setConfig] = useState<AppConfig>({
    serverUrl: 'ws://localhost:8000/ws',
    frameRate: 800, // Slightly slower to ensure TTS finishes
    simulationMode: true, // Default to true for demo purposes
  });

  const toggleActive = () => setIsActive(!isActive);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
        <div className="flex items-center space-x-3">
          <Eye className="w-8 h-8 text-yellow-400" />
          <h1 className="text-2xl font-bold tracking-wider">VISION ASSIST</h1>
        </div>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="p-3 bg-gray-800 rounded-lg hover:bg-gray-700 focus:ring-4 focus:ring-yellow-400"
          aria-label="Settings"
        >
          <Settings className="w-6 h-6" />
        </button>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="p-4 bg-gray-800 border-b border-yellow-500 space-y-4">
          <h2 className="text-xl font-bold text-yellow-400">Settings</h2>
          
          <div className="flex items-center justify-between">
            <span className="text-lg">Simulation Mode (No Backend)</span>
            <button 
              onClick={() => setConfig(prev => ({...prev, simulationMode: !prev.simulationMode}))}
              className={`w-16 h-8 rounded-full flex items-center p-1 transition-colors ${config.simulationMode ? 'bg-yellow-500' : 'bg-gray-600'}`}
            >
              <div className={`w-6 h-6 bg-white rounded-full transform transition-transform ${config.simulationMode ? 'translate-x-8' : ''}`} />
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-gray-400">Backend URL</label>
            <input 
              type="text" 
              value={config.serverUrl}
              onChange={(e) => setConfig(prev => ({...prev, serverUrl: e.target.value}))}
              className="w-full bg-black border border-gray-600 p-3 rounded text-white"
              disabled={config.simulationMode}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        <CameraView config={config} isActive={isActive} />
      </main>

      {/* Footer / Controls */}
      <footer className="p-6 bg-gray-900 border-t border-gray-800 flex justify-center">
        <button
          onClick={toggleActive}
          className={`
            flex items-center justify-center space-x-4
            w-full max-w-md py-6 rounded-2xl font-bold text-2xl uppercase tracking-widest shadow-lg
            transition-transform transform active:scale-95 focus:ring-4 focus:ring-white
            ${isActive 
              ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/50' 
              : 'bg-yellow-500 hover:bg-yellow-400 text-black shadow-yellow-900/50'}
          `}
          aria-label={isActive ? "Stop Assistant" : "Start Assistant"}
        >
          {isActive ? <PauseCircle className="w-10 h-10" /> : <PlayCircle className="w-10 h-10" />}
          <span>{isActive ? "STOP ASSISTANT" : "START ASSISTANT"}</span>
        </button>
      </footer>
    </div>
  );
};

export default App;