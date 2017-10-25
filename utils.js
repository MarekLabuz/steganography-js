const mod = (x, n = 256) => ((x % n) + n) % n

const parseHex = string => parseInt(string, 16)

const toHex = (int, pL) => {
  return mod(int).toString(16).padStart(2, '0')
}

function PaethPredictor (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) {
    return a
  } else if (pb <= pc) {
    return b
  } else {
    return c
  }
}

const w = (channelsHexLength, fn, ...rgbs) => {
  const r = rgbs.map(rgb => rgb ? rgb.slice(0, 2) : '00')
  const fR = fn(...r)

  const g = rgbs.map(rgb => rgb ? rgb.slice(2, 4): '00')
  const fG = fn(...g)

  const b = rgbs.map(rgb => rgb ? rgb.slice(4, 6) : '00')
  const fB = fn(...b)

  switch (channelsHexLength) {
    case 8: {
      const a = rgbs.map(rgb => rgb ? rgb.slice(6, 8) : '00')
      const fA = fn(...a)

      return fR + fG + fB + fA
    }
    default:
    case 6: {
      return fR + fG + fB
    }
  }
}

const getChannelsHexLength = (colorType) => {
  switch (colorType) {
    case 6:
      return 8
    case 2:
      return 6
    default:
      console.error('Image with such color type is not supported. Supported color types: 2, 6.')
      process.exit(0)
  }
}

const filtersMethods = {
  '00': (matrix, r, c, channelsHexLength) => w(channelsHexLength, v => toHex(parseHex(v)), matrix[r][c]),
  '01': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2) => toHex(parseHex(v1) + (rev ? 1 : -1) * parseHex(v2)), matrix[r][c], matrix[r][c - 1]),
  '02': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2) => toHex(parseHex(v1) + (rev ? 1 : -1) * parseHex(v2)), matrix[r][c], matrix[r - 1][c]),
  '03': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2, v3) => toHex(parseHex(v1) + (rev ? 1 : -1) * Math.floor((parseHex(v2) + parseHex(v3)) / 2)), matrix[r][c], matrix[r][c - 1], matrix[r - 1][c]),
  '04': (matrix, r, c, channelsHexLength, rev) => w(channelsHexLength, (v1, v2, v3, v4) => toHex(parseHex(v1) + (rev ? 1 : -1) * PaethPredictor(parseHex(v2), parseHex(v3), parseHex(v4))), matrix[r][c], matrix[r][c - 1], matrix[r - 1][c], matrix[r - 1][c - 1])
}

const convertStringToMatrix = (string, width, height, channelsHexLength) => {
  const rowLength = 2 + width * channelsHexLength
  const matrix = []
  const filters = []
  for (let i = 0; i < string.length; i += rowLength) {
    const row = string.slice(i, i + rowLength)
    const [filterMethod, pixels] = [row.slice(0, 2), row.slice(2)]
    const rowArray = []
    for (let j = 0; j < pixels.length; j += channelsHexLength) {
      rowArray.push(pixels.slice(j, j + channelsHexLength))
    }
    filters.push(filterMethod)
    matrix.push(rowArray)
  }
  matrix.forEach((row, r) => {
    const filter = filtersMethods[filters[r]]
    row.forEach((column, c) => {
      matrix[r][c] = filter(matrix, r, c, channelsHexLength, true)
    })
  })
  return { matrix, filters }
}

const convertMatrixToString = (matrix, filters, channelsHexLength) => {
  let string = ''
  const filteredMatrix = matrix
    .map((row, r) => {
      const filter = filtersMethods[filters[r]]
      const newRow = row.map((columns, c) => filter(matrix, r, c, channelsHexLength))
      return newRow
    })

  filteredMatrix.forEach((row, r) => {
    string += filters[r] + row.join('')
  })

  return string
}

module.exports = {
  getChannelsHexLength,
  convertStringToMatrix,
  convertMatrixToString
}