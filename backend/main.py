import base64
import cv2
import numpy as np
import asyncio
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from ultralytics import YOLO

# Initialize App and Logger
app = FastAPI()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("VisionAssistant")

# Global State
latest_frame_cv2 = None
latest_detections = []
prev_frame_detections = [] # To track growth/movement between frames
# Simple in-memory storage for face encodings and names
known_face_encodings = []
known_face_names = []

# Optional Face Recognition
try:
    import face_recognition
    FACE_REC_AVAILABLE = True
except ImportError:
    FACE_REC_AVAILABLE = False
    logger.warning("face_recognition library not found. Face memory features disabled.")

# Load YOLOv8 Model
try:
    model = YOLO("yolov8n.pt")
except Exception as e:
    logger.error(f"Failed to load YOLO model: {e}")
    model = None

@app.get("/")
async def root():
    return {"status": "Vision Assistant Backend is Running"}

def get_iou(boxA, boxB):
    # box: [x1, y1, x2, y2] normalized
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])

    iou = interArea / float(boxAArea + boxBArea - interArea + 1e-6)
    return iou

def process_image_and_update_state(img):
    """
    Runs object detection and face recognition on the image.
    Updates global state variables.
    Returns the standard frontend response object.
    """
    global latest_frame_cv2, latest_detections, prev_frame_detections, known_face_encodings, known_face_names

    if model is None:
        return {"command": "Error: Model not loaded", "objects": [], "is_obstacle": False}

    height, width, _ = img.shape
    latest_frame_cv2 = img # Store for command processing

    # 1. YOLO Inference
    results = model(img, verbose=False)
    
    current_frame_objects = []
    
    # Define "Center" area
    # Tighter center focus for navigation commands (35% to 65%)
    center_x_min, center_x_max = 0.35, 0.65
    
    # High risk objects logic
    high_risk_classes = ['car', 'truck', 'bus', 'motorcycle', 'train', 'stairs', 'person']

    highest_threat_score = 0
    most_dangerous_object = None
    
    # 2. Process YOLO Boxes
    for r in results:
        boxes = r.boxes
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy() # Ensure numpy float
            w_box = x2 - x1
            h_box = y2 - y1
            conf = float(box.conf[0])
            cls = int(box.cls[0])
            label = model.names[cls]
            
            if conf < 0.4: continue

            # Normalize coordinates (0 to 1)
            norm_x1 = x1 / width
            norm_y1 = y1 / height
            norm_x2 = x2 / width
            norm_y2 = y2 / height
            norm_w = w_box / width
            norm_h = h_box / height
            norm_area = norm_w * norm_h
            center_x = norm_x1 + (norm_w / 2)
            
            # --- Face Recognition Logic (Preserved) ---
            if label == 'person' and FACE_REC_AVAILABLE:
                if norm_area > 0.02: 
                    face_crop = img[int(y1):int(y2), int(x1):int(x2)]
                    if face_crop.size > 0:
                        rgb_face = cv2.cvtColor(face_crop, cv2.COLOR_BGR2RGB)
                        if len(known_face_encodings) > 0:
                            try:
                                current_encodings = face_recognition.face_encodings(rgb_face)
                                if current_encodings:
                                    matches = face_recognition.compare_faces(known_face_encodings, current_encodings[0], tolerance=0.55)
                                    if True in matches:
                                        first_match_index = matches.index(True)
                                        name = known_face_names[first_match_index]
                                        label = f"Person: {name}"
                            except Exception:
                                pass
            # ------------------------------------------

            # --- Advanced Threat Calculation ---
            
            # Factor 1: Proximity/Size (Weight: 2.0)
            # Larger area means closer.
            score_size = norm_area * 2.0

            # Factor 2: Vertical Position (Weight: 1.5)
            # norm_y2 is the bottom of the box. 
            # If norm_y2 -> 1.0, the object is at the user's feet.
            # If norm_y2 -> 0.0, the object is floating above (less likely to be a trip hazard, usually).
            score_vertical = norm_y2 * 1.5

            # Factor 3: Centrality (Weight: 1.5)
            # 1.0 if perfectly centered, 0.0 if at edge
            dist_from_center = abs(center_x - 0.5)
            score_centrality = (0.5 - dist_from_center) * 3.0 # Multiplied by 3 to normalize roughly to 1.5 max weight

            # Factor 4: Growth Rate / Approach Velocity (Weight: 1.0)
            # Compare with previous frame to see if it's getting bigger
            growth_bonus = 0.0
            matched_prev = None
            
            # Find match in previous frame (Simple IOU + Label match)
            best_iou = 0
            for prev_obj in prev_frame_detections:
                if prev_obj['label'] == label: # Only compare same class
                    iou = get_iou(
                        [norm_x1, norm_y1, norm_x2, norm_y2], 
                        [prev_obj['x1'], prev_obj['y1'], prev_obj['x2'], prev_obj['y2']]
                    )
                    if iou > 0.3 and iou > best_iou: # Threshold for "same object"
                        best_iou = iou
                        matched_prev = prev_obj
            
            if matched_prev:
                prev_area = matched_prev['area']
                if prev_area > 0:
                    growth = (norm_area - prev_area) / prev_area
                    # If grown by more than 5%, it's approaching fast
                    if growth > 0.05:
                        growth_bonus = 0.5 # Significant bonus for approaching objects
                    elif growth > 0.02:
                        growth_bonus = 0.2

            # Calculate Final Threat Score
            base_threat = score_size + score_vertical + score_centrality + growth_bonus
            
            # Multiplier for high-risk classes
            if label in high_risk_classes:
                base_threat *= 1.3
            
            # Determine Distance Category based on Threat Score
            # Thresholds tuned for safety
            if base_threat > 1.8:
                dist_category = "immediate"
            elif base_threat > 0.8:
                dist_category = "near"
            else:
                dist_category = "far"

            obj_data = {
                "label": label,
                "confidence": conf,
                "bbox": [norm_x1, norm_y1, norm_w, norm_h],
                "distance_category": dist_category,
                "threat_score": base_threat,
                # Store raw coords for next frame comparison
                "x1": norm_x1, "y1": norm_y1, "x2": norm_x2, "y2": norm_y2, "area": norm_area
            }
            
            current_frame_objects.append(obj_data)

            # Track highest threat
            if base_threat > highest_threat_score:
                highest_threat_score = base_threat
                most_dangerous_object = obj_data

    # Update global state for next iteration
    latest_detections = current_frame_objects
    prev_frame_detections = current_frame_objects 

    # 3. Free Space (Bottom crop heuristic)
    # Analyze the bottom 25% center strip for texture/obstacles
    bottom_crop = img[int(height*0.75):height, int(width*0.25):int(width*0.75)]
    gray_bottom = cv2.cvtColor(bottom_crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray_bottom, 50, 150)
    edge_density = np.sum(edges) / (edges.size * 255)
    free_space_score = max(0, min(100, 100 - (edge_density * 400))) # Slightly relaxed density calc

    # 4. Generate Navigational Command
    command = "Path clear."
    is_obstacle_immediate = False

    if most_dangerous_object:
        lbl = most_dangerous_object['label']
        cat = most_dangerous_object['distance_category']
        
        # Immediate Stop Condition
        # If threat is immediate OR (it's near AND free space is very low)
        if cat == "immediate" or (cat == "near" and free_space_score < 20):
            is_obstacle_immediate = True
            command = f"Stop. {lbl} ahead."
        
        # Warning Condition
        elif cat == "near":
            # Directional logic
            cx = most_dangerous_object['bbox'][0] + (most_dangerous_object['bbox'][2]/2)
            if cx < 0.4:
                command = f"{lbl} on your left."
            elif cx > 0.6:
                command = f"{lbl} on your right."
            else:
                command = f"Approaching {lbl}."
        
        # General Guidance
        elif free_space_score < 40:
            command = "Caution. Floor is uneven."

    return {
        "command": command,
        "free_space_percentage": int(free_space_score),
        "objects": current_frame_objects,
        "is_obstacle": is_obstacle_immediate
    }

def handle_voice_command(text):
    """
    Processes natural language commands against the latest frame state.
    """
    global latest_frame_cv2, latest_detections, known_face_encodings, known_face_names
    
    text = text.lower().strip()
    
    if latest_frame_cv2 is None:
        return "I can't see anything yet."

    # Command: "Remember this person as [Name]" or "Identify person as [Name]"
    # Handles: "remember this person as john", "remember as john", "identify as john"
    if ("remember" in text or "identify" in text) and "as" in text:
        if not FACE_REC_AVAILABLE:
            return "Face recognition is not enabled on the server."
            
        try:
            # Parse Name
            parts = text.split(" as ")
            if len(parts) > 1:
                raw_name = parts[1].strip()
                clean_name = raw_name.strip(".,!?")
                name_part = clean_name.title()
            else:
                return "I didn't catch the name. Please say 'Remember as Name'."

            if not name_part:
                return "I didn't hear a valid name."

            # Find faces in the CURRENT frame
            rgb_frame = cv2.cvtColor(latest_frame_cv2, cv2.COLOR_BGR2RGB)
            boxes = face_recognition.face_locations(rgb_frame)
            
            if not boxes:
                return "I don't see a face clearly enough to remember."
                
            # If multiple faces, pick the largest one
            max_size = 0
            idx_best = -1
            for i, (top, right, bottom, left) in enumerate(boxes):
                size = (bottom - top) * (right - left)
                if size > max_size:
                    max_size = size
                    idx_best = i
            
            if idx_best == -1:
                return "Could not isolate a face."

            # Encode the best face
            encodings = face_recognition.face_encodings(rgb_frame, [boxes[idx_best]])
            
            if encodings:
                known_face_encodings.append(encodings[0])
                known_face_names.append(name_part)
                logger.info(f"Learned face: {name_part}")
                return f"I have remembered this person as {name_part}."
            else:
                return "I couldn't capture the face details."
                
        except Exception as e:
            logger.error(f"Error in remembering face: {e}")
            return "Sorry, I encountered an error saving that face."

    # Command: "What is in front of me?"
    elif "front" in text or "ahead" in text:
        # Filter strictly for center objects
        center_objs = [o['label'] for o in latest_detections 
                       if o['distance_category'] in ['near', 'immediate']]
        if center_objs:
            unique_objs = list(set(center_objs))
            return f"In front of you, I see: {', '.join(unique_objs)}."
        return "The path in front seems clear."

    # Command: "Describe surroundings"
    elif "describe" in text or "see" in text:
        if not latest_detections:
            return "I don't see any distinct objects."
        counts = {}
        for o in latest_detections:
            lbl = o['label']
            counts[lbl] = counts.get(lbl, 0) + 1
        desc = [f"{c} {l}" + ("s" if c > 1 else "") for l, c in counts.items()]
        return "I see " + ", ".join(desc) + "."

    return "Command not recognized."

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected")
    try:
        while True:
            # Receive JSON string
            raw_msg = await websocket.receive_text()
            try:
                msg = json.loads(raw_msg)
                msg_type = msg.get("type")
                data = msg.get("data")

                if msg_type == "image":
                    # Standard Frame Processing
                    if ',' in data:
                        data = data.split(',')[1]
                    img_bytes = base64.b64decode(data)
                    nparr = np.frombuffer(img_bytes, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if img is not None:
                        # Process in thread
                        response = await asyncio.to_thread(process_image_and_update_state, img)
                        await websocket.send_json(response)

                elif msg_type == "command":
                    # Voice Command Processing
                    voice_response_text = await asyncio.to_thread(handle_voice_command, data)
                    # Respond with high priority command
                    resp = {
                        "command": voice_response_text,
                        "free_space_percentage": 0,
                        "objects": [],
                        "is_obstacle": False
                    }
                    await websocket.send_json(resp)

            except json.JSONDecodeError:
                pass
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket Error: {e}")
        try:
            await websocket.close()
        except:
            pass