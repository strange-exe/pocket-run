// three.js ships no types of its own, and @types/three pulls in a physics engine and other runtime packages.
// The only user is the about page's decorative backdrop (about-field.ts), so its two entry points are untyped.
declare module "three/webgpu";
declare module "three/tsl";
