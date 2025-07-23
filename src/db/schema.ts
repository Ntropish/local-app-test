import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { unitsOfMeasurement } from './enums'

export const ingredients = sqliteTable('ingredients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull().unique(),
  description: text('description'),
  unit_of_measurement: text('unit_of_measurement', {
    enum: unitsOfMeasurement,
  }),
  base_value: real('base_value').notNull(),
})
