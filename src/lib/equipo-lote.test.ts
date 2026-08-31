import { describe, expect, it } from 'vitest'

import { filasValidas, nombreDesdeEmail, parsearLote } from './equipo-lote'

describe('nombreDesdeEmail', () => {
  it('separa por punto', () => {
    expect(nombreDesdeEmail('gustavo.rodrigz@gmail.com')).toBe('Gustavo Rodrigz')
  })

  it('separa por guion bajo', () => {
    expect(nombreDesdeEmail('maria_lopez@gmail.com')).toBe('Maria Lopez')
  })

  it('separa donde el propio mail cambia a mayúscula', () => {
    expect(nombreDesdeEmail('SantyVergara113@gmail.com')).toBe('Santy Vergara')
  })

  it('los números del final no son parte del nombre', () => {
    expect(nombreDesdeEmail('abriilsegura08@gmail.com')).toBe('Abriilsegura')
  })

  it('sin separadores no inventa el corte', () => {
    expect(nombreDesdeEmail('joacavarela@gmail.com')).toBe('Joacavarela')
  })

  it('un mail que es solo números deja algo escribible, no vacío', () => {
    expect(nombreDesdeEmail('12345@gmail.com')).toBe('12345')
  })
})

describe('parsearLote — las tres formas en que llega la lista', () => {
  it('solo el mail: el nombre se propone', () => {
    const [fila] = parsearLote('benjaleiva35@gmail.com')
    expect(fila).toMatchObject({
      linea: 1,
      email: 'benjaleiva35@gmail.com',
      nombre: 'Benjaleiva',
      error: null,
    })
  })

  it('mail y nombre separados por coma', () => {
    const [fila] = parsearLote('benjaleiva35@gmail.com, Benja Leiva')
    expect(fila).toMatchObject({ email: 'benjaleiva35@gmail.com', nombre: 'Benja Leiva' })
  })

  it('nombre con el mail entre signos de mayor y menor', () => {
    const [fila] = parsearLote('Benja Leiva <benjaleiva35@gmail.com>')
    expect(fila).toMatchObject({ email: 'benjaleiva35@gmail.com', nombre: 'Benja Leiva' })
  })

  it('el mail se guarda en minúsculas', () => {
    const [fila] = parsearLote('Pilargirardi9@Gmail.com')
    expect(fila?.email).toBe('pilargirardi9@gmail.com')
  })
})

describe('parsearLote — lo que no entra', () => {
  it('ignora las líneas vacías y conserva el número de línea real', () => {
    const filas = parsearLote('\n\nuno@ejemplo.com\n   \ndos@ejemplo.com\n')
    expect(filas).toHaveLength(2)
    expect(filas.map((f) => f.linea)).toEqual([3, 5])
  })

  it('una línea sin arroba vuelve con su motivo, no desaparece', () => {
    const [fila] = parsearLote('Victoria Amilibia')
    expect(fila?.error).toBe('No encuentro ningún email en esta línea.')
  })

  it('un mail mal escrito vuelve con su motivo', () => {
    const [fila] = parsearLote('victoriaamilibia8@')
    expect(fila?.error).toBe('Ese email no tiene formato válido.')
  })

  it('el repetido se marca, y se marca el segundo', () => {
    const filas = parsearLote('uno@ejemplo.com\nUno@ejemplo.com')
    expect(filas[0]?.error).toBeNull()
    expect(filas[1]?.error).toBe('Este email ya estaba más arriba en la lista.')
    expect(filasValidas(filas)).toHaveLength(1)
  })

  it('una lista con problemas igual entrega los que sí sirven', () => {
    const filas = parsearLote(
      ['ok1@ejemplo.com', 'esto no es un mail', 'ok2@ejemplo.com, Dos'].join('\n'),
    )
    expect(filasValidas(filas).map((f) => f.email)).toEqual(['ok1@ejemplo.com', 'ok2@ejemplo.com'])
  })
})
