// ========================================================================
// RUGBY PLUGIN - FIGMA PLUGIN MAIN SCRIPT
// ========================================================================
// RuGBy (Red-Green-Blue) Plugin generates color gradients between two hexcodes
// with a maximum of 65,536 colors. This main script handles all Figma API
// interactions, color generation, frame creation, and export functionality.

// ========================================================================
// GLOBAL STATE & CONFIGURATION
// ========================================================================
// This section manages the plugin's global state including frame positioning
// and UI configuration. It establishes the plugin dimensions and maintains
// state for consistent frame placement across multiple generations.
let lastFramePosition = null;

// Show the UI with optimized dimensions
figma.showUI(__html__, { width: 560, height: 420 });

// ========================================================================
// UTILITY FUNCTIONS & COLOR CALCULATIONS
// ========================================================================
// This section contains optimized utility functions for color manipulation
// and mathematical operations. These functions handle color conversions,
// interpolation, and validation needed throughout the generation process.
const colorUtils = {
  // Convert hex color to integer for mathematical operations
  hexToInt: (hex) => parseInt(hex.replace('#', ''), 16),
  
  // Convert integer back to hex color format
  intToHex: (int) => '#' + int.toString(16).padStart(6, '0').toUpperCase(),
  
  // Interpolate between two colors with given factor (0-1)
  interpolateColor: (color1, color2, factor) => {
    const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
    const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;
    
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    
    return (r << 16) | (g << 8) | b;
  }
};

// ========================================================================
// FRAME CREATION & POSITIONING
// ========================================================================
// This section handles Figma frame creation, positioning, and management.
// It calculates optimal dimensions, positions frames intelligently, and
// maintains consistent spacing between generated color grids.
const frameManager = {
  // Create and configure a new frame for color generation
  createFrame: (initialColor, finalColor, width, height) => {
    const frame = figma.createFrame();
    // Use single hexcode name if initial and final colors are the same
    frame.name = initialColor === finalColor ? initialColor : `${initialColor} - ${finalColor}`;
    frame.resize(width, height);
    frame.fills = [];
    frame.clipsContent = true;
    return frame;
  },
  
  // Position frame intelligently based on previous generation
  positionFrame: (frame, width, height) => {
    if (lastFramePosition) {
      frame.x = lastFramePosition.x + lastFramePosition.width + 50;
      frame.y = lastFramePosition.y;
    } else {
      const viewport = figma.viewport.center;
      frame.x = Math.round(viewport.x - width / 2);
      frame.y = Math.round(viewport.y - height / 2);
    }
    
    // Update last position for next generation
    lastFramePosition = { x: frame.x, y: frame.y, width, height };
  },
  
  // Calculate optimal grid dimensions for given color count
  calculateGridDimensions: (count) => {
    const sqrt = Math.sqrt(count);
    const cols = Math.ceil(sqrt);
    const rows = Math.ceil(count / cols);
    const pixelSize = 1; // Always use 1px for individual color boxes
    
    return {
      cols,
      rows,
      pixelSize,
      frameWidth: cols * pixelSize,
      frameHeight: rows * pixelSize
    };
  }
};

// ========================================================================
// COLOR GENERATION ENGINE
// ========================================================================
// This section contains the core color generation logic with batch processing
// for performance optimization. It handles large color sets efficiently and
// provides progress feedback during generation operations.
const colorGenerator = {
  // Generate color rectangles in optimized batches
  generateColorBatch: (startColor, colorStep, startIdx, batchCount, cols, pixelSize) => {
    const rectangles = [];
    
    for (let i = 0; i < batchCount; i++) {
      const colorIndex = startIdx + i;
      
      // Calculate color value using linear interpolation
      const colorValue = Math.round(startColor + colorIndex * colorStep);
      const r = (colorValue >> 16) & 0xFF;
      const g = (colorValue >> 8) & 0xFF;
      const b = colorValue & 0xFF;
      
      // Calculate grid position
      const col = colorIndex % cols;
      const row = Math.floor(colorIndex / cols);
      
      // Create and configure rectangle
      const rect = figma.createRectangle();
      rect.resize(pixelSize, pixelSize);
      rect.x = col * pixelSize;
      rect.y = row * pixelSize;
      rect.fills = [{
        type: 'SOLID',
        color: { r: r / 255, g: g / 255, b: b / 255 }
      }];
      
      rectangles.push(rect);
    }
    
    return rectangles;
  },
  
  // Calculate optimal batch size based on total count
  calculateBatchSize: (count) => Math.min(2000, count),
  
  // Determine if yield is needed for performance
  shouldYield: (batchCount) => batchCount > 500
};

// ========================================================================
// PROGRESS TRACKING & UI COMMUNICATION
// ========================================================================
// This section manages progress reporting and communication with the UI.
// It provides real-time feedback during generation and handles all message
// exchanges between the plugin and user interface components.
const progressManager = {
  // Send progress update to UI
  updateProgress: (batch, totalBatches, endIdx, count) => {
    const progress = Math.round(((batch + 1) / totalBatches) * 100);
    
    figma.ui.postMessage({
      type: 'generation-progress',
      percentage: progress,
      current: endIdx,
      total: count,
      message: `${endIdx.toLocaleString()} / ${count.toLocaleString()} colors (${progress}%)`
    });
    
    // Show Figma notifications less frequently for performance
    if (batch % 10 === 0 || batch === totalBatches - 1) {
      figma.notify(`Progress: ${progress}% (${endIdx.toLocaleString()}/${count.toLocaleString()} colors)`);
    }
  },
  
  // Send completion message to UI
  notifyComplete: (count, cols, rows, frameWidth, frameHeight) => {
    const dimensionInfo = `${cols}×${rows} grid (${frameWidth}×${frameHeight}px)`;
    figma.notify(`✅ Generated ${count} colors successfully! ${dimensionInfo}`);
    
    figma.ui.postMessage({
      type: 'generation-complete',
      count: count,
      dimensions: dimensionInfo,
      pixelSize: 1,
      gridSize: `${cols}×${rows}`
    });
  },
  
  // Send error message to UI
  notifyError: (error) => {
    console.error('Generation error:', error);
    figma.notify(`❌ Generation failed: ${error.message}`);
    
    figma.ui.postMessage({
      type: 'generation-error',
      error: error.message
    });
  }
};

// ========================================================================
// AUTO-EXPORT FUNCTIONALITY
// ========================================================================
// This section handles automatic file export operations for generated color
// grids. It supports both PNG and SVG formats with optimized export settings
// and provides seamless file download integration with the UI.
const exportManager = {
  // Handle auto-export with format-specific settings
  handleAutoExport: async (frame, exportFormat) => {
    if (exportFormat !== 'png' && exportFormat !== 'svg') return;
    
    try {
      // Configure export settings based on format
      const exportSettings = exportFormat === 'png' 
        ? { format: 'PNG', constraint: { type: 'SCALE', value: 1 } }
        : { format: 'SVG' };
      
      console.log(`Starting ${exportFormat.toUpperCase()} export process...`);
      const exportData = await frame.exportAsync(exportSettings);
      console.log('Export data generated, size:', exportData.length);
      
      // Generate clean filename from frame name
      const cleanFrameName = frame.name.replace(/[#]/g, '').replace(/[\s-]+/g, '-');
      const fileExtension = exportFormat === 'png' ? 'png' : 'svg';
      const filename = `${cleanFrameName}.${fileExtension}`;
      
      // Send export data to UI for download
      figma.ui.postMessage({
        type: 'auto-export',
        exportData: Array.from(exportData),
        filename: filename,
        format: exportFormat
      });
      
      figma.notify(`🎉 ${exportFormat.toUpperCase()} export ready! Download starting...`);
    } catch (exportError) {
      console.error('Export error:', exportError);
      figma.notify(`⚠️ Auto-export failed: ${exportError.message}`);
    }
  }
};

// ========================================================================
// MAIN COLOR GENERATION FUNCTION
// ========================================================================
// This section contains the primary generation logic that orchestrates all
// other components. It validates input, manages the generation process, and
// coordinates frame creation, color calculation, and export operations.
async function generateColors(initialColor, finalColor, count, exportFormat) {
  try {
    console.log(`Generating ${count} colors from ${initialColor} to ${finalColor}`);
    
    // Validate count limit for performance
    if (count > 65536) {
      throw new Error('Cannot generate more than 65,536 hexcodes');
    }

    // Convert hex colors to integers for mathematical operations
    const startColor = colorUtils.hexToInt(initialColor);
    const endColor = colorUtils.hexToInt(finalColor);

    // Calculate color interpolation step
    const totalSteps = count - 1;
    const colorStep = totalSteps > 0 ? (endColor - startColor) / totalSteps : 0;

    // Calculate optimal grid dimensions
    const { cols, rows, pixelSize, frameWidth, frameHeight } = frameManager.calculateGridDimensions(count);

    // Create and position main frame
    const frame = frameManager.createFrame(initialColor, finalColor, frameWidth, frameHeight);
    frameManager.positionFrame(frame, frameWidth, frameHeight);

    // Generate colors in optimized batches
    const batchSize = colorGenerator.calculateBatchSize(count);
    const totalBatches = Math.ceil(count / batchSize);
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const startIdx = batch * batchSize;
      const endIdx = Math.min(startIdx + batchSize, count);
      const batchCount = endIdx - startIdx;
      
      // Generate color rectangles for this batch
      const rectangles = colorGenerator.generateColorBatch(
        startColor, colorStep, startIdx, batchCount, cols, pixelSize
      );
      
      // Add rectangles to frame
      rectangles.forEach(rect => frame.appendChild(rect));
      
      // Update progress
      progressManager.updateProgress(batch, totalBatches, endIdx, count);
      
      // Yield control for performance if needed
      if (colorGenerator.shouldYield(batchCount)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Select and focus the completed frame
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    // Handle auto-export if requested
    await exportManager.handleAutoExport(frame, exportFormat);

    // Notify completion
    progressManager.notifyComplete(count, cols, rows, frameWidth, frameHeight);

  } catch (error) {
    progressManager.notifyError(error);
  }
}

// ========================================================================
// MESSAGE HANDLING & PLUGIN INITIALIZATION
// ========================================================================
// This section handles all communication between the UI and plugin main thread.
// It processes user commands, validates input, and coordinates the generation
// workflow while providing comprehensive error handling and user feedback.
figma.ui.onmessage = async (message) => {
  console.log('Received message:', message.type);

  try {
    switch (message.type) {
      case 'ui-ready':
        console.log('UI is ready');
        break;

      case 'generate-colors':
        await generateColors(
          message.initialColor,
          message.finalColor,
          message.count,
          message.exportFormat
        );
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  } catch (error) {
    console.error('Error processing message:', error);
    figma.notify(`Error: ${error.message}`);
    
    figma.ui.postMessage({
      type: 'generation-error',
      error: error.message
    });
  }
};

// ========================================================================
// PLUGIN STARTUP
// ========================================================================
// This section logs the successful initialization of the RuGBy plugin and
// confirms that all components are loaded and ready for user interaction.
// It provides confirmation that the plugin environment is properly configured.
console.log('RuGBy plugin loaded successfully');