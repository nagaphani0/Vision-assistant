export interface DetectedObject {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, width, height] normalized 0-1
  distance_category: 'immediate' | 'near' | 'far';
}

export interface VisionResponse {
  command: string; // The spoken instruction e.g., "Stop, chair ahead."
  free_space_percentage: number;
  objects: DetectedObject[];
  is_obstacle: boolean;
}

export interface AppConfig {
  serverUrl: string;
  frameRate: number; // ms between frames
  simulationMode: boolean; // For testing without backend
}

export type WSMessage = 
  | { type: 'image'; data: string }
  | { type: 'command'; data: string };
