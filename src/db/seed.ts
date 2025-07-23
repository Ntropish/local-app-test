import { log } from './utils'

export const seed = async (db: any, schema: any) => {
  log('Seeding database...')
  try {
    await db.insert(schema.ingredients).values([
      {
        title: 'Eye of Newt',
        description: "The classic ingredient for any witch's brew.",
        unit_of_measurement: 'pieces',
        base_value: 1.5,
      },
      {
        title: 'Toe of Frog',
        description: 'Adds a little kick to your potions.',
        unit_of_measurement: 'pieces',
        base_value: 2.0,
      },
      {
        title: 'Wool of Bat',
        description: 'For potions of flight and levitation.',
        unit_of_measurement: 'grams',
        base_value: 3.2,
      },
      {
        title: 'Tongue of Dog',
        description: 'A versatile ingredient for many spells.',
        unit_of_measurement: 'pieces',
        base_value: 1.0,
      },
      {
        title: "Adder's Fork",
        description: 'A potent component for transformation potions.',
        unit_of_measurement: 'pieces',
        base_value: 5.0,
      },
      {
        title: "Blind-worm's Sting",
        description: 'Used in potions of invisibility.',
        unit_of_measurement: 'ounces',
        base_value: 7.5,
      },
      {
        title: "Lizard's Leg",
        description: 'A common ingredient for healing potions.',
        unit_of_measurement: 'pieces',
        base_value: 2.5,
      },
      {
        title: "Howlet's Wing",
        description: 'For potions that affect the mind.',
        unit_of_measurement: 'grams',
        base_value: 4.0,
      },
    ])
    log('Seeding complete.')
  } catch (e: any) {
    log('Seeding failed:', e.message)
    // It's useful to see the actual error during development
    if (import.meta.env.DEV) {
      console.error(e)
    }
  }
}

export default seed
