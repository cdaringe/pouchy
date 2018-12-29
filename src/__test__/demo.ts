import Pouchy from '..'
import memory from 'pouchdb-adapter-memory'
require('perish')
Pouchy.plugin(memory)

type DemoMovieSchema = {
  title: string
  stars: number
}

async function runDemo () {
  const pouch = new Pouchy<DemoMovieSchema>({
    name: 'demodb'
  })
  const saved = await pouch.save({
    title: 'LOTR',
    stars: 3
  })
  console.log(saved)
  const all = await pouch.all()
  all.forEach((doc, i) => console.log(`doc "${i}":`, doc))
  const updated = await pouch.save({
    ...saved,
    title: 'LOTRZ',
    stars: 5
  })
  const allUpdated = await pouch.all()
  console.log(`total docs should equal 1: ${allUpdated.length}`)
  await pouch.save({
    title: 'spiderman 8million',
    stars: 0
  })
  const allUpdated2 = await pouch.all()
  console.log(`total docs should equal 2: ${allUpdated2.length}`)
}

runDemo()
