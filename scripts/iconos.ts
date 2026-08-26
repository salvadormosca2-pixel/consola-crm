import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

/**
 * Íconos de la PWA.
 *
 * Se generan acá en vez de arrastrar un binario al repo: son cuatro rectángulos
 * y un fondo, y así se pueden regenerar si cambia la paleta sin abrir un editor
 * de imágenes. Sin dependencias: PNG a mano con zlib.
 *
 *   npm run iconos
 *
 * El dibujo es el medidor de cupo de 101leads —barras segmentadas que se
 * llenan en el verde de marca—, que es la marca visual del sistema y lo que el
 * setter ve arriba de todo en su pantalla.
 */

const FONDO = [0x02, 0x10, 0x0d] as const
const ACENTO = [0x1f, 0xc7, 0x9e] as const
/** Los segmentos vacíos: el borde fino de la interfaz, no un gris claro. */
const APAGADO = [0x12, 0x31, 0x2a] as const

const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo))
  return Buffer.concat([largo, cuerpo, crc])
}

/** PNG RGB de 8 bits, sin filtros. */
function png(ancho: number, alto: number, pixeles: Uint8Array): Buffer {
  const conFiltro = Buffer.alloc(alto * (1 + ancho * 3))
  for (let y = 0; y < alto; y++) {
    conFiltro[y * (1 + ancho * 3)] = 0
    Buffer.from(pixeles.buffer, y * ancho * 3, ancho * 3).copy(
      conFiltro,
      y * (1 + ancho * 3) + 1,
    )
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(ancho, 0)
  ihdr.writeUInt32BE(alto, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 2 // color: RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(conFiltro, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Dibuja el medidor. `margen` es la proporción de borde libre: los íconos
 * enmascarables de Android se recortan en círculo, así que el dibujo tiene que
 * caber en el 80% central o queda mocho.
 */
function medidor(lado: number, margen: number): Uint8Array {
  const px = new Uint8Array(lado * lado * 3)
  for (let i = 0; i < lado * lado; i++) {
    px[i * 3] = FONDO[0]
    px[i * 3 + 1] = FONDO[1]
    px[i * 3 + 2] = FONDO[2]
  }

  const pintar = (x0: number, y0: number, w: number, h: number, c: readonly number[]): void => {
    for (let y = Math.max(y0, 0); y < Math.min(y0 + h, lado); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x0 + w, lado); x++) {
        const i = (y * lado + x) * 3
        px[i] = c[0]!
        px[i + 1] = c[1]!
        px[i + 2] = c[2]!
      }
    }
  }

  const util = lado * (1 - margen * 2)
  const origen = lado * margen

  // Cuatro barras de diez segmentos, llenas a distinta altura.
  const barras = 4
  const segmentos = 10
  const llenos = [7, 10, 4, 8]

  const anchoBarra = util / (barras * 2 - 1)
  const altoSeg = util / (segmentos * 2 - 1)

  for (let b = 0; b < barras; b++) {
    const x = Math.round(origen + b * anchoBarra * 2)
    for (let s = 0; s < segmentos; s++) {
      const encendido = s < llenos[b]!
      // Se dibuja de abajo hacia arriba: el segmento 0 es el de más abajo.
      const y = Math.round(origen + (segmentos - 1 - s) * altoSeg * 2)
      pintar(
        x,
        y,
        Math.max(Math.round(anchoBarra), 1),
        Math.max(Math.round(altoSeg), 1),
        encendido ? ACENTO : APAGADO,
      )
    }
  }

  return px
}

const salida = resolve(process.cwd(), 'public/iconos')
mkdirSync(salida, { recursive: true })

const archivos: Array<{ nombre: string; lado: number; margen: number }> = [
  // Los normales usan casi todo el cuadro; los enmascarables dejan el borde
  // libre porque Android los recorta.
  { nombre: 'icono-192.png', lado: 192, margen: 0.18 },
  { nombre: 'icono-512.png', lado: 512, margen: 0.18 },
  { nombre: 'icono-maskable-512.png', lado: 512, margen: 0.28 },
  { nombre: 'apple-touch-icon.png', lado: 180, margen: 0.2 },
]

for (const { nombre, lado, margen } of archivos) {
  writeFileSync(resolve(salida, nombre), png(lado, lado, medidor(lado, margen)))
  console.log(`  ${nombre}  ${lado}×${lado}`)
}

console.log(`\nÍconos escritos en public/iconos.`)
