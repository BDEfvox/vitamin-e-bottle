# Vitamin E

A real-time product shot in the browser: one matte-black vitamin E dropper bottle with a gold collar, spinning and bobbing like a dropped item in Minecraft, over wet black gravel with black dunes behind it.

**Live:** https://bdefvox.github.io/vitamin-e-bottle/

Space pauses. Add `?t=3` to the address for a still at 3 seconds, or `?res=1080` to render at exactly 1080 x 1080.

## How it works

The camera never moves, so the sky, the dunes, the gravel and all of the background blur are rendered once at load into a single image. Each frame only draws the bottle (twice, once for its reflection), composites it with that image, and applies foreground blur, lens glow and film grain. Everything is procedural; there are no image or model files.

Built with [three.js](https://threejs.org/).

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5210. `npm run build` writes `bundle.js`, after which `index.html` also opens by double-click.

The product and its label are fictional.
