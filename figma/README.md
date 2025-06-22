# RuGBy - Color Bucket Generator for AllRGB Images

A Figma plugin designed to generate color buckets for creating AllRGB images. Each bucket contains 65,536 colors arranged in a perfect 256x256 grid.

## Features

- **Independent Component Locking**: Lock R, G, and B values separately using intuitive lock/unlock icons
- **Color Bucket Generation**: Creates frames named "cb-<R value>" for easy organization
- **256x256 Resolution**: Each frame is exactly 256x256 pixels for perfect PNG export
- **AllRGB Mission**: Generate 256 color buckets (one for each R value) to create complete AllRGB images

## How to Use

### Color Bucket Generation

1. **Set Initial Values**: Enter the starting RGB values (e.g., `00 00 00`)
2. **Set Final Values**: Enter the ending RGB values (e.g., `00 FF FF`)
3. **Lock Components**: 
   - 🔒 **R Locked**: R value stays constant across the bucket
   - 🔒 **G Locked**: G value stays constant across the bucket  
   - 🔓 **B Unlocked**: B value varies to create color range
4. **Generate**: Click "GENERATE" to create the color bucket frame

### Lock System

- **🔒 Locked**: Component value is synchronized between initial and final
- **🔓 Unlocked**: Component value can vary independently
- **Click to Toggle**: Click any lock icon to toggle its state

### Typical Color Bucket Workflow

For generating complete AllRGB color buckets:

1. Start with R=00, G=00, B=00 (initial)
2. End with R=00, G=FF, B=FF (final)
3. Keep R and G locked (🔒🔒🔓)
4. Generate → Creates "cb-00" frame with 65,536 colors
5. Change R to 01, repeat → Creates "cb-01" frame
6. Continue for all R values (00-FF) → 256 total buckets

### Export Settings

Each generated frame is automatically configured for PNG export at 256x256 resolution. Simply:

1. Select the frame
2. Right-click → Export
3. Choose PNG format
4. Export at 1x scale for exact 256x256 pixels

## Technical Details

- **Frame Size**: Exactly 256x256 pixels for standard export
- **Color Count**: Up to 65,536 colors per frame (256×256 grid)
- **Naming**: Frames named "cb-<RR>" where RR is the hex R value
- **Positioning**: Sequential vertical stacking of generated frames
- **Reset**: Use "Reset Position" to start fresh positioning

## AllRGB Image Creation

1. Generate all 256 color buckets (cb-00 through cb-FF)
2. Export each as PNG (256x256 resolution)
3. Combine all PNGs → Complete AllRGB image (65,536×256 pixels)

Each bucket represents one vertical slice of the final AllRGB image, with R constant and G,B varying across the full range.

## Installation

### Development Mode

1. Clone this repository
2. Open Figma Desktop app
3. Go to Plugins > Development > Import plugin from manifest...
4. Select the `manifest.json` file from this repository
5. The plugin will now be available in your development plugins

### From Figma Community (Once Published)

1. Visit the Figma Community page for RuGBy
2. Click "Install"
3. The plugin will be available in your Figma plugins

## Usage

1. In Figma, go to Plugins > RuGBy > Generate Color Transitions
2. Choose one of the two tabs:
   - **Count Hexcodes**: Enter two hexcodes to find out how many colors exist between them
   - **Generate Gradient**: Enter start and end colors, specify the number of steps, and create a smooth gradient
3. To apply a gradient to your design, click "Create Gradient in Figma" after generating the colors

## Development

This plugin is built with:
- HTML/CSS/JavaScript for the UI
- Figma Plugin API for integration with Figma

## About

This plugin was inspired by the need for precise color control in gradient design. There are 16,777,216 possible hexcodes (256 values for each RGB channel), and this plugin helps you navigate and utilize them effectively.

## License

MIT 