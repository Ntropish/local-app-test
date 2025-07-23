import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { ingredients } from '../../db'
import { useDatabase } from '../../db/database-context'
import { eq } from 'drizzle-orm'
import { unitsOfMeasurement, type UnitOfMeasurement } from '../../db/enums'

interface Ingredient {
  id: number
  title: string
  description: string | null
  unit_of_measurement: UnitOfMeasurement | null
  base_value: number
}

interface EditIngredientModalProps {
  editId: number | null
  onClose: () => void
}

export function EditIngredientModal({
  editId,
  onClose,
}: EditIngredientModalProps) {
  const queryClient = useQueryClient()
  const { db, isInitialized } = useDatabase()

  // 'pendingChanges' will hold only the fields the user has modified.
  const [pendingChanges, setPendingChanges] = useState<Partial<Ingredient>>({})

  // Fetch the ingredient to edit. This is the source of truth for the form.
  const { data: ingredient, isLoading } = useQuery({
    queryKey: ['ingredient', editId],
    queryFn: async () => {
      if (!db || !editId)
        throw new Error('Database not initialized or no edit ID')

      const result = await db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, Number(editId)))
        .get()

      return result
    },
    enabled: !!editId && isInitialized && !!db,
  })

  // When the modal opens for a new ingredient (i.e., editId changes),
  // we must reset any lingering pending changes from a previous edit.
  useEffect(() => {
    setPendingChanges({})
  }, [editId])

  // Update ingredient mutation
  const updateIngredientMutation = useMutation({
    mutationFn: async (updatedIngredient: Partial<Ingredient>) => {
      if (!editId || !db)
        throw new Error('No ingredient ID provided or database not initialized')
      return await db
        .update(ingredients)
        .set(updatedIngredient)
        .where(eq(ingredients.id, Number(editId)))
        .returning()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      queryClient.invalidateQueries({ queryKey: ['ingredients-count'] })
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // A title is always required. Check the pending change or the original.
    const finalTitle = pendingChanges.title ?? ingredient?.title
    if (!finalTitle) return

    // Only submit if there are actual changes.
    if (Object.keys(pendingChanges).length === 0) {
      onClose() // No changes, just close the modal.
      return
    }

    updateIngredientMutation.mutate(pendingChanges)
  }

  const isOpen = !!editId

  // For display, we use the pending change if it exists, otherwise the original ingredient data.
  const displayIngredient = {
    ...ingredient,
    ...pendingChanges,
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Ingredient</DialogTitle>
          <DialogDescription>
            Make changes to the ingredient here. Click save when you're done.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : ingredient ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Name</Label>
              <Input
                id="title"
                value={displayIngredient.title || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPendingChanges((prev) => ({
                    ...prev,
                    title: e.target.value,
                  }))
                }
                placeholder="Ingredient name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={displayIngredient.description ?? ''}
                onChange={(e) =>
                  setPendingChanges((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Optional description"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit">Unit of Measurement</Label>
              <Select
                value={displayIngredient.unit_of_measurement ?? 'none'}
                onValueChange={(value: UnitOfMeasurement | 'none') => {
                  setPendingChanges((prev) => ({
                    ...prev,
                    unit_of_measurement: value === 'none' ? null : value,
                  }))
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {unitsOfMeasurement.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {/* Simple title case for display */}
                      {unit.charAt(0).toUpperCase() + unit.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseValue">Base Value ($)</Label>
              <Input
                id="baseValue"
                type="number"
                step="0.01"
                min="0"
                value={displayIngredient.base_value ?? 0}
                onChange={(e) =>
                  setPendingChanges((prev) => ({
                    ...prev,
                    base_value: parseFloat(e.target.value) || 0,
                  }))
                }
                placeholder="0.00"
                required
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  updateIngredientMutation.isPending ||
                  !displayIngredient.title ||
                  Object.keys(pendingChanges).length === 0
                }
              >
                {updateIngredientMutation.isPending
                  ? 'Saving...'
                  : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Ingredient not found
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
