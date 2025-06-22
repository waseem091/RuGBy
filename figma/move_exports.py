#!/usr/bin/env python3
"""
RuGBy Export Mover
Automatically moves cb-*.png files from Downloads to the cb-png directory.
Run this script after generating color buckets to organize your exports.
"""

import os
import shutil
import glob
from pathlib import Path

def move_cb_exports():
    """Move all cb-*.png files from Downloads to cb-png directory."""
    
    # Define paths
    downloads_dir = Path.home() / "Downloads"
    target_dir = Path("C:/Users/muham/OneDrive/Desktop/RuGBy/cb-png")
    
    # Ensure target directory exists
    target_dir.mkdir(parents=True, exist_ok=True)
    
    # Find all cb-*.png files in Downloads
    pattern = str(downloads_dir / "cb-*.png")
    cb_files = glob.glob(pattern)
    
    if not cb_files:
        print("❌ No cb-*.png files found in Downloads folder")
        return
    
    moved_count = 0
    
    for file_path in cb_files:
        try:
            file_name = os.path.basename(file_path)
            target_path = target_dir / file_name
            
            # Move the file
            shutil.move(file_path, target_path)
            print(f"✅ Moved {file_name} to cb-png directory")
            moved_count += 1
            
        except Exception as e:
            print(f"❌ Failed to move {file_name}: {e}")
    
    print(f"\n🎉 Successfully moved {moved_count} files to cb-png directory!")
    print(f"📁 Location: {target_dir}")

if __name__ == "__main__":
    print("🚀 RuGBy Export Mover")
    print("Moving cb-*.png files from Downloads to cb-png directory...\n")
    
    try:
        move_cb_exports()
    except Exception as e:
        print(f"❌ Error: {e}")
    
    input("\nPress Enter to exit...") 