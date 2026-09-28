/**
 * WebGL2 compositor: draw video/image frames and title overlays onto a canvas.
 */

import type { CaptionLine, TimelineClip, TitleStyleId } from "@cinakey/shared";

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texLoc: WebGLUniformLocation | null;
  private tex: WebGLTexture;
  private overlay: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private posBuf: WebGLBuffer;
  private texBuf: WebGLBuffer;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;

    const vs = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
    const fs = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, v_uv);
}`;
    this.program = linkProgram(gl, vs, fs);
    this.texLoc = gl.getUniformLocation(this.program, "u_tex");

    this.posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    this.texBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
      gl.STATIC_DRAW,
    );

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.overlay = document.createElement("canvas");
    this.overlayCtx = this.overlay.getContext("2d")!;
  }

  resize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.overlay.width = width;
      this.overlay.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  clear(r = 0.04, g = 0.04, b = 0.05) {
    const gl = this.gl;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Draw an HTMLVideoElement, HTMLImageElement, or canvas into the frame. */
  drawMedia(
    source: TexImageSource,
    opts?: { flipY?: boolean },
  ) {
    const gl = this.gl;
    gl.useProgram(this.program);

    const posLoc = gl.getAttribLocation(this.program, "a_pos");
    const uvLoc = gl.getAttribLocation(this.program, "a_uv");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuf);
    if (opts?.flipY) {
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
        gl.STATIC_DRAW,
      );
    } else {
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
        gl.STATIC_DRAW,
      );
    }
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return;
    }
    if (this.texLoc) gl.uniform1i(this.texLoc, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  drawTitles(
    clips: Array<{ clip: TimelineClip; localT: number }>,
  ) {
    const ctx = this.overlayCtx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);

    for (const { clip } of clips) {
      if (clip.source.type !== "text") continue;
      const styleId = clip.source.styleId;
      const lines =
        clip.source.lines && clip.source.lines.length > 0
          ? clip.source.lines
          : [{ id: "t", text: clip.source.text }];
      drawStyledText(ctx, w, h, styleId, lines);
    }

    if (clips.length > 0) {
      this.drawMedia(this.overlay);
    }
  }

  /** 2D canvas snapshot for export (copies current GL buffer). */
  snapshot2d(): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(this.canvas, 0, 0);
    return out;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.texBuf);
  }
}

function drawStyledText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  styleId: TitleStyleId,
  lines: CaptionLine[],
) {
  const text = lines.map((l) =>
    l.characterName ? `${l.characterName}: ${l.text}` : l.text,
  );
  const fontSize = Math.max(16, Math.round(h * (styleId === "caption" ? 0.045 : 0.06)));
  ctx.font = `600 ${fontSize}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fafafa";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = Math.max(2, fontSize * 0.08);

  if (styleId === "centered") {
    ctx.textAlign = "center";
    const startY = h * 0.5 - ((text.length - 1) * fontSize * 1.2) / 2;
    text.forEach((line, i) => {
      const y = startY + i * fontSize * 1.2;
      ctx.strokeText(line, w / 2, y);
      ctx.fillText(line, w / 2, y);
    });
    return;
  }

  if (styleId === "lower-third") {
    ctx.textAlign = "left";
    const pad = Math.round(w * 0.04);
    const barH = fontSize * text.length * 1.35 + pad;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, h - barH, w * 0.55, barH);
    ctx.fillStyle = "#fafafa";
    text.forEach((line, i) => {
      const y = h - barH + pad * 0.7 + i * fontSize * 1.25 + fontSize * 0.5;
      ctx.fillText(line, pad, y);
    });
    return;
  }

  // caption
  ctx.textAlign = "center";
  const pad = Math.round(h * 0.04);
  const blockH = text.length * fontSize * 1.25 + pad;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(w * 0.1, h - blockH - pad, w * 0.8, blockH);
  ctx.fillStyle = "#fafafa";
  text.forEach((line, i) => {
    const y = h - blockH - pad + pad * 0.6 + i * fontSize * 1.25 + fontSize * 0.5;
    ctx.strokeText(line, w / 2, y);
    ctx.fillText(line, w / 2, y);
  });
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram {
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(vs) ?? "VS compile failed");
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(fs) ?? "FS compile failed");
  }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? "Link failed");
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}
