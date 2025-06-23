/*! For license information please see code.js.LICENSE.txt */
(()=>{function e(){var t,n,o="function"==typeof Symbol?Symbol:{},a=o.iterator||"@@iterator",i=o.toStringTag||"@@toStringTag";function c(e,o,a,i){var c=o&&o.prototype instanceof l?o:l,u=Object.create(c.prototype);return r(u,"_invoke",function(e,r,o){var a,i,c,l=0,u=o||[],f=!1,g={p:0,n:0,v:t,a:m,f:m.bind(t,4),d:function(e,r){return a=e,i=0,c=t,g.n=r,s}};function m(e,r){for(i=e,c=r,n=0;!f&&l&&!o&&n<u.length;n++){var o,a=u[n],m=g.p,p=a[2];e>3?(o=p===r)&&(i=a[4]||3,c=a[5]===t?a[3]:a[5],a[4]=3,a[5]=t):a[0]<=m&&((o=e<2&&m<a[1])?(i=0,g.v=r,g.n=a[1]):m<p&&(o=e<3||a[0]>r||r>p)&&(a[4]=e,a[5]=r,g.n=p,i=0))}if(o||e>1)return s;throw f=!0,r}return function(o,u,p){if(l>1)throw TypeError("Generator is already running");for(f&&1===u&&m(u,p),i=u,c=p;(n=i<2?t:c)||!f;){a||(i?i<3?(i>1&&(g.n=-1),m(i,c)):g.n=c:g.v=c);try{if(l=2,a){if(i||(o="next"),n=a[o]){if(!(n=n.call(a,c)))throw TypeError("iterator result is not an object");if(!n.done)return n;c=n.value,i<2&&(i=0)}else 1===i&&(n=a.return)&&n.call(a),i<2&&(c=TypeError("The iterator does not provide a '"+o+"' method"),i=1);a=t}else if((n=(f=g.n<0)?c:e.call(r,g))!==s)break}catch(e){a=t,i=1,c=e}finally{l=1}}return{value:n,done:f}}}(e,a,i),!0),u}var s={};function l(){}function u(){}function f(){}n=Object.getPrototypeOf;var g=[][a]?n(n([][a]())):(r(n={},a,(function(){return this})),n),m=f.prototype=l.prototype=Object.create(g);function p(e){return Object.setPrototypeOf?Object.setPrototypeOf(e,f):(e.__proto__=f,r(e,i,"GeneratorFunction")),e.prototype=Object.create(m),e}return u.prototype=f,r(m,"constructor",f),r(f,"constructor",u),u.displayName="GeneratorFunction",r(f,i,"GeneratorFunction"),r(m),r(m,i,"Generator"),r(m,a,(function(){return this})),r(m,"toString",(function(){return"[object Generator]"})),(e=function(){return{w:c,m:p}})()}function r(e,t,n,o){var a=Object.defineProperty;try{a({},"",{})}catch(e){a=0}r=function(e,t,n,o){if(t)a?a(e,t,{value:n,enumerable:!o,configurable:!o,writable:!o}):e[t]=n;else{var i=function(t,n){r(e,t,(function(e){return this._invoke(t,n,e)}))};i("next",0),i("throw",1),i("return",2)}},r(e,t,n,o)}function t(e,r,t,n,o,a,i){try{var c=e[a](i),s=c.value}catch(e){return void t(e)}c.done?r(s):Promise.resolve(s).then(n,o)}function n(e){return function(){var r=this,n=arguments;return new Promise((function(o,a){var i=e.apply(r,n);function c(e){t(i,o,a,c,s,"next",e)}function s(e){t(i,o,a,c,s,"throw",e)}c(void 0)}))}}var o=null,a=null;function i(){return c.apply(this,arguments)}function c(){return(c=n(e().m((function r(){var t,n,i,c,s,l,u;return e().w((function(e){for(;;)switch(e.n){case 0:try{console.time("all-rgb-generation"),figma.notify("🎨 Starting All-RGB generation using WebGL acceleration..."),null!==o&&null!==a?(t=Math.round(o),n=Math.round(a+20)):(t=Math.round(figma.viewport.center.x-2048),n=Math.round(figma.viewport.center.y-2048),(i=figma.currentPage.selection).length>0&&(c=i[0],t=Math.round(c.x+c.width+50),n=Math.round(c.y))),(s=figma.createFrame()).resize(4096,4096),s.x=t,s.y=n,s.name="all-rgb",s.clipsContent=!0,s.fills=[],s.strokes=[],s.effects=[],o=t,a=n+4096,l=Date.now(),figma.ui.postMessage({type:"generate-all-rgb-webgl",width:4096,height:4096,startTime:l})}catch(e){console.error("❌ Failed to create All-RGB image:",e),u=e instanceof Error?e.message:String(e),figma.notify("Failed to create All-RGB image: ".concat(u))}case 1:return e.a(2)}}),r)})))).apply(this,arguments)}function s(e,r){try{e=e.replace("#",""),r=r.replace("#","");for(var t=parseInt(e,16),n=parseInt(r,16),o=Math.min(t,n),a=Math.max(t,n),i=[],c=o;c<=a;c++){var s=c.toString(16).padStart(6,"0");i.push("#".concat(s))}return t>n&&i.reverse(),i}catch(e){return console.error("❌ Error generating hexcodes:",e),[]}}function l(e){return u.apply(this,arguments)}function u(){return(u=n(e().m((function r(t){var n,o,a,i,c,l,u,f,g,m,p,h,d,y,v;return e().w((function(e){for(;;)switch(e.n){case 0:try{for(console.time("color-squares-generation"),t&&0!==t.length||(console.warn("No hexcodes provided. Using default red to blue gradient."),t=s("#FF0000","#0000FF")),n=t.length,o=Math.ceil(Math.sqrt(n)),a=Math.ceil(n/o),i=50*o+5*(o-1),c=50*a+5*(a-1),(l=figma.createFrame()).name="color-transition-".concat(n,"-colors"),l.resize(i,c),l.fills=[{type:"SOLID",color:{r:1,g:0,b:1}}],l.x=figma.viewport.center.x-i/2,l.y=figma.viewport.center.y-c/2,u=0;u<n;u++)f=u%o,g=Math.floor(u/o),(m=figma.createRectangle()).resize(50,50),m.x=55*f,m.y=55*g,r=(r=t[u]).replace("#",""),p={r:parseInt(r.substring(0,2),16),g:parseInt(r.substring(2,4),16),b:parseInt(r.substring(4,6),16)},h=p.r,d=p.g,y=p.b,m.fills=[{type:"SOLID",color:{r:h/255,g:d/255,b:y/255}}],l.appendChild(m);figma.currentPage.selection=[l],figma.viewport.scrollAndZoomIntoView([l]),console.timeEnd("color-squares-generation"),figma.notify("✅ Created ".concat(n," color squares successfully!"))}catch(e){console.error("❌ Error creating color squares:",e),v=e instanceof Error?e.message:String(e),figma.notify("Error creating color squares: ".concat(v))}case 1:return e.a(2)}var r}),r)})))).apply(this,arguments)}figma.showUI(__html__,{width:640,height:460}),figma.ui.onmessage=function(){var r=n(e().m((function r(t){return e().w((function(e){for(;;)switch(e.n){case 0:console.log("Plugin received message:",t),"ui-loaded"===t.type&&(console.log("UI loaded at:",new Date(t.timestamp).toLocaleTimeString()),figma.ui.postMessage({type:"welcome",message:"Hello from the plugin code!",timestamp:Date.now()})),"test-message"===t.type&&(console.log("Test message received:",t.content),figma.ui.postMessage({type:"echo",originalMessage:t.content,timestamp:Date.now()})),t.type;case 1:return e.a(2)}}),r)})));return function(e){return r.apply(this,arguments)}}(),figma.ui.onmessage=function(){var r=n(e().m((function r(t){var n,o,a,c,u,f,g,m,p,h,d,y;return e().w((function(e){for(;;)switch(e.n){case 0:console.log("Received message from UI:",t.type),e.p=1,h=t.type,e.n="generate-colors"===h?2:"generate-all-rgb-webgl"===h?4:"png-encoded"===h?6:"cancel"===h?11:12;break;case 2:return n=s(t.initialColor,t.finalColor),o=n.length>t.count?n.filter((function(e,r){return r*(n.length/t.count)%1==0})).slice(0,t.count):n,e.n=3,l(o);case 3:return e.a(3,13);case 4:return e.n=5,i();case 5:return e.a(3,13);case 6:if(e.p=6,a=new Uint8Array(t.data),c=figma.createImage(a),!((u=figma.currentPage.findAll((function(e){return"FRAME"===e.type&&e.name.startsWith("all-rgb")}))).length>0)){e.n=7;break}f=u[u.length-1],(g=figma.createRectangle()).resize(f.width,f.height),g.x=0,g.y=0,g.fills=[{type:"IMAGE",scaleMode:"FILL",imageHash:c.hash}],f.appendChild(g),figma.currentPage.selection=[f],figma.viewport.scrollAndZoomIntoView([f]),t.renderMethod&&(f.name="all-rgb-".concat(t.renderMethod,"-").concat((t.renderTime/1e3).toFixed(2),"s")),figma.notify("✅ All-RGB image created successfully! (".concat((t.renderTime/1e3).toFixed(2),"s)")),e.n=8;break;case 7:throw new Error("No target frame found for the image");case 8:e.n=10;break;case 9:e.p=9,d=e.v,console.error("❌ Error creating image from PNG data:",d),m=d instanceof Error?d.message:String(d),figma.notify("Error creating image: ".concat(m));case 10:return e.a(3,13);case 11:return figma.closePlugin(),e.a(3,13);case 12:console.warn("Unknown message type: ".concat(t.type));case 13:e.n=15;break;case 14:e.p=14,y=e.v,console.error("❌ Error processing message:",y),p=y instanceof Error?y.message:String(y),figma.notify("Error: ".concat(p));case 15:return e.a(2)}}),r,null,[[6,9],[1,14]])})));return function(e){return r.apply(this,arguments)}}()})();

// RuGBy Plugin - Clean and Functional Implementation
// Generates color gradients between two hexcodes with a maximum of 65,536 colors

let lastFramePosition = null;

// Show the UI
figma.showUI(__html__, { width: 560, height: 420 });

// Listen for messages from the UI
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

// Generate colors between two hexcodes
async function generateColors(initialColor, finalColor, count, exportFormat) {
  try {
    console.log(`Generating ${count} colors from ${initialColor} to ${finalColor}`);
    
    // Validate count limit
    if (count > 65536) {
      throw new Error('Cannot generate more than 65,536 hexcodes');
    }

    // Convert hex colors to RGB integers
    const startColor = hexToInt(initialColor);
    const endColor = hexToInt(finalColor);

    // Calculate step size for color interpolation
    const totalSteps = count - 1;
    const colorStep = totalSteps > 0 ? (endColor - startColor) / totalSteps : 0;

    // Determine frame dimensions with 1px maximum constraint
    let frameWidth, frameHeight, pixelSize;
    
    // Always use 1px for individual color boxes
    pixelSize = 1;
    
    // Calculate optimal grid dimensions
    const sqrt = Math.sqrt(count);
    const cols = Math.ceil(sqrt);
    const rows = Math.ceil(count / cols);
    
    frameWidth = cols * pixelSize;
    frameHeight = rows * pixelSize;

    // Create main frame with proper naming format
    const frame = figma.createFrame();
    frame.name = `${initialColor} - ${finalColor}`;
    frame.resize(frameWidth, frameHeight);
    frame.fills = [];
    frame.clipsContent = true;

    // Position frame
    if (lastFramePosition) {
      frame.x = lastFramePosition.x + lastFramePosition.width + 50;
      frame.y = lastFramePosition.y;
    } else {
      const viewport = figma.viewport.center;
      frame.x = Math.round(viewport.x - frameWidth / 2);
      frame.y = Math.round(viewport.y - frameHeight / 2);
    }

    // Update last position
    lastFramePosition = { x: frame.x, y: frame.y, width: frameWidth, height: frameHeight };

    // Generate colors in batches to avoid UI freezing
    const batchSize = Math.min(2000, count);
    const totalBatches = Math.ceil(count / batchSize);
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const startIdx = batch * batchSize;
      const endIdx = Math.min(startIdx + batchSize, count);
      const batchCount = endIdx - startIdx;
      
      // Create rectangles for this batch
      const rectangles = [];
      
      for (let i = 0; i < batchCount; i++) {
        const colorIndex = startIdx + i;
        
        // Calculate color value
        const colorValue = Math.round(startColor + colorIndex * colorStep);
        const r = (colorValue >> 16) & 0xFF;
        const g = (colorValue >> 8) & 0xFF;
        const b = colorValue & 0xFF;
        
        // Calculate position
        const col = colorIndex % cols;
        const row = Math.floor(colorIndex / cols);
        
        // Create rectangle
        const rect = figma.createRectangle();
        rect.resize(pixelSize, pixelSize);
        rect.x = col * pixelSize;
        rect.y = row * pixelSize;
        
        // Set color
        rect.fills = [{
          type: 'SOLID',
          color: {
            r: r / 255,
            g: g / 255,
            b: b / 255
          }
        }];
        
        rectangles.push(rect);
      }
      
      // Add rectangles to frame
      rectangles.forEach(rect => frame.appendChild(rect));
      
      // Send progress update to UI
      const progress = Math.round(((batch + 1) / totalBatches) * 100);
      figma.ui.postMessage({
        type: 'generation-progress',
        percentage: progress,
        current: endIdx,
        total: count,
        message: `${endIdx.toLocaleString()} / ${count.toLocaleString()} colors (${progress}%)`
      });
      
      // Also show in Figma notifications (less frequent)
      if (batch % 10 === 0 || batch === totalBatches - 1) {
        figma.notify(`Progress: ${progress}% (${endIdx.toLocaleString()}/${count.toLocaleString()} colors)`);
      }
      
      // Yield control to prevent UI freezing
      if (batchCount > 500) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Select and focus the frame
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    // Show completion message
    const dimensionInfo = `${cols}×${rows} grid (${frameWidth}×${frameHeight}px)`;
    figma.notify(`✅ Generated ${count} colors successfully! ${dimensionInfo}`);

    // Auto-export functionality
    if (exportFormat === 'png' || exportFormat === 'svg') {
      try {
        // Export settings based on format
        const exportSettings = exportFormat === 'png' 
          ? { format: 'PNG', constraint: { type: 'SCALE', value: 1 } }
          : { format: 'SVG' };
        
        console.log(`Starting ${exportFormat.toUpperCase()} export process...`);
        const exportData = await frame.exportAsync(exportSettings);
        console.log('Export data generated, size:', exportData.length);
        
        // Use frame name for filename
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

    // Send success message to UI
    figma.ui.postMessage({
      type: 'generation-complete',
      count: count,
      dimensions: dimensionInfo,
      pixelSize: pixelSize,
      gridSize: `${cols}×${rows}`
    });

  } catch (error) {
    console.error('Generation error:', error);
    figma.notify(`❌ Generation failed: ${error.message}`);
    
    figma.ui.postMessage({
      type: 'generation-error',
      error: error.message
    });
  }
}

// Utility function to convert hex color to integer
function hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

// Utility function to convert integer to hex color
function intToHex(int) {
  return '#' + int.toString(16).padStart(6, '0').toUpperCase();
}

// Utility function to interpolate between two colors
function interpolateColor(color1, color2, factor) {
  const r1 = (color1 >> 16) & 0xFF;
  const g1 = (color1 >> 8) & 0xFF;
  const b1 = color1 & 0xFF;
  
  const r2 = (color2 >> 16) & 0xFF;
  const g2 = (color2 >> 8) & 0xFF;
  const b2 = color2 & 0xFF;
  
  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);
  
  return (r << 16) | (g << 8) | b;
}

console.log('RuGBy plugin loaded successfully');