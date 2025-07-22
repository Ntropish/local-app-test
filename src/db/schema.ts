import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const ingredients = sqliteTable('ingredients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull().unique(),
  description: text('description'),
  unitOfMeasurement: text('unit_of_measurement'),
  baseValue: real('base_value').notNull(),
})
