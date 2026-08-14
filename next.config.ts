import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /*
   * Un `next build` escribe en el mismo directorio que usa `next dev`, y le
   * rompe las referencias a sus chunks: el servidor de desarrollo empieza a
   * tirar "Cannot find module './570.js'" y hay que borrar .next a mano.
   *
   * `npm run build:check` levanta NEXT_DIST_DIR y compila en otra carpeta, así
   * se puede verificar que el build pasa sin voltear el dev que está corriendo.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  experimental: {
    // El importador de la fase 2 sube archivos grandes a server actions.
    serverActions: { bodySizeLimit: '10mb' },
  },
}

export default nextConfig
