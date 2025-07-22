import { log } from './utils'

export const seed = async (db: any, schema: any) => {
  log('Seeding database...')
  try {
    await db.insert(schema.ingredients).values([
      {
        title: 'Eye of Newt',
        description: "The classic ingredient for any witch's brew.",
        unitOfMeasurement: 'unit',
        baseValue: 1.5,
      },
      {
        title: 'Toe of Frog',
        description: 'Adds a little kick to your potions.',
        unitOfMeasurement: 'unit',
        baseValue: 2.0,
      },
      {
        title: 'Wool of Bat',
        description: 'For potions of flight and levitation.',
        unitOfMeasurement: 'pinch',
        baseValue: 3.2,
      },
      {
        title: 'Tongue of Dog',
        description: 'A versatile ingredient for many spells.',
        unitOfMeasurement: 'unit',
        baseValue: 1.0,
      },
      {
        title: "Adder's Fork",
        description: 'A potent component for transformation potions.',
        unitOfMeasurement: 'unit',
        baseValue: 5.0,
      },
      {
        title: "Blind-worm's Sting",
        description: 'Used in potions of invisibility.',
        unitOfMeasurement: 'drop',
        baseValue: 7.5,
      },
      {
        title: "Lizard's Leg",
        description: 'A common ingredient for healing potions.',
        unitOfMeasurement: 'unit',
        baseValue: 2.5,
      },
      {
        title: "Howlet's Wing",
        description: 'For potions that affect the mind.',
        unitOfMeasurement: 'feather',
        baseValue: 4.0,
      },
    ])
    log('Seeding complete.')
  } catch (e) {
    log('Seeding failed, maybe already seeded?')
  }
}

export default seed
