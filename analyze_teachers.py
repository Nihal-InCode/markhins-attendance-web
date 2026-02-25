import sqlite3
import json

def analyze_teachers():
    conn = sqlite3.connect('attendance.db')
    c = conn.cursor()
    
    # Get all teachers
    c.execute("SELECT * FROM teachers")
    teachers = c.fetchall()
    
    # Get column names
    c.execute("PRAGMA table_info(teachers)")
    cols = [cc[1] for cc in c.fetchall()]
    
    # Analyze roles
    analysis = {
        "columns": cols,
        "sample_teachers": [],
        "unique_subjects": set(),
        "unique_classes": set(),
        "role_detection": []
    }
    
    for t in teachers:
        t_dict = dict(zip(cols, t))
        analysis["sample_teachers"].append(t_dict)
        analysis["unique_subjects"].add(t_dict.get("subject"))
        analysis["unique_classes"].add(t_dict.get("class_teacher_of"))
        
        # Determine role based on data
        role = "Subject Teacher"
        if t_dict.get("subject") == "Principal":
            role = "Principal"
        elif t_dict.get("class_teacher_of") and t_dict.get("class_teacher_of") != "None" and t_dict.get("class_teacher_of") != "":
            role = "Class Teacher"
            
        analysis["role_detection"].append({
            "name": t_dict.get("name"),
            "subject": t_dict.get("subject"),
            "class_teacher_of": t_dict.get("class_teacher_of"),
            "detected_role": role
        })
        
    analysis["unique_subjects"] = list(analysis["unique_subjects"])
    analysis["unique_classes"] = list(analysis["unique_classes"])
    
    print(json.dumps(analysis, indent=2))
    conn.close()

if __name__ == "__main__":
    analyze_teachers()
