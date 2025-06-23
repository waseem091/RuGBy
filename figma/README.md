# RuGBy - Red u Green By

A Figma plugin for generating beautiful color gradients between two hexcode values with precise control and optimization.

## Features

- **Hexcode Input**: Separate RGB input fields for precise color control
- **Live Preview**: Real-time gradient preview as you adjust colors
- **Link Values**: Link R, G, or B components between initial and final colors
- **Smart Count Display**: Shows total hexcodes with warnings for large ranges
- **65,536 Limit**: Enforced maximum to prevent performance issues
- **Optimized Rendering**: 
  - 1px boxes for exactly 65,536 colors (256×256 grid)
  - Larger boxes for smaller counts
  - Batched generation to prevent UI freezing

## Usage

1. **Set Initial Color**: Enter RGB hex values (00-FF) for the starting color
2. **Set Final Color**: Enter RGB hex values (00-FF) for the ending color
3. **Link Components**: Click link buttons (🔗) to synchronize R, G, or B values
4. **Monitor Count**: Watch the hexcode count and warnings
5. **Generate**: Click Generate to create the color gradient

## Technical Details

### Color Generation
- Calculates linear interpolation between initial and final hexcode integers
- Generates all intermediate colors in the range
- Supports up to 65,536 unique colors maximum

### Frame Sizing
- **65,536 colors**: 256×256 frame with 1px rectangles
- **≤1,024 colors**: 10px rectangles
- **≤4,096 colors**: 5px rectangles  
- **>4,096 colors**: 2px rectangles

### Performance
- Batched generation (1,000 colors per batch)
- Progress notifications during generation
- Automatic frame positioning to avoid overlaps

## File Structure

```
figma/
├── ui.html          # Main UI interface
├── code.js          # Plugin logic and Figma API
├── manifest.json    # Plugin configuration
├── worker.js        # Legacy WebGL worker (unused)
└── README.md        # This file
```

## Development

The plugin uses vanilla JavaScript and CSS for maximum compatibility and performance. No external dependencies required.

### Key Functions

- `generateColors()`: Main color generation logic
- `hexToInt()`: Converts hex strings to integers
- `validateHex()`: Validates and formats hex input
- `updateColorPreview()`: Updates color preview boxes
- `updateHexCount()`: Calculates and displays total colors

## Limitations

- Maximum 65,536 colors to prevent performance issues
- Only generates linear color gradients (no curves or complex transitions)
- Colors are generated as individual rectangles (not as a single image)

## Export Options

- **PNG**: Generates frames that can be exported as PNG images
- **SVG**: Generates frames that can be exported as SVG vectors

## Tips

- Use linked values to create gradients along single color channels
- Start with small ranges to test before generating large gradients
- Position your viewport where you want the frames to appear
- Smaller color counts will use larger, more visible rectangles

---

**Version**: 2.0.0  
**Last Updated**: 2024  
**Figma API**: 1.0.0 