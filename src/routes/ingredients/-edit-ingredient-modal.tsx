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
import { db, ingredients, waitForDB } from '../../db'
import { eq } from 'drizzle-orm'

interface Ingredient {
  id: number
  title: string
  description: string | null
  unitOfMeasurement: string | null
  baseValue: number
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

  const [formData, setFormData] = useState<Partial<Ingredient>>({
    title: '',
    description: '',
    unitOfMeasurement: null,
    baseValue: 0,
  })

  // Fetch the ingredient to edit
  const { data: ingredient, isLoading } = useQuery({
    queryKey: ['ingredient', editId],
    queryFn: async () => {
      if (!editId) return null
      await waitForDB()
      const result = await db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, editId))
        .get()
      return result || null
    },
    enabled: !!editId,
  })

  // Update form data when ingredient is loaded
  useEffect(() => {
    if (ingredient) {
      setFormData({
        title: ingredient.title,
        description: ingredient.description || '',
        unitOfMeasurement: ingredient.unitOfMeasurement || null,
        baseValue: ingredient.baseValue,
      })
    }
  }, [ingredient])

  // Update ingredient mutation
  const updateIngredientMutation = useMutation({
    mutationFn: async (updatedIngredient: Partial<Ingredient>) => {
      if (!editId) throw new Error('No ingredient ID provided')
      await waitForDB()
      return await db
        .update(ingredients)
        .set(updatedIngredient)
        .where(eq(ingredients.id, editId))
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
    if (!formData.title || formData.baseValue === undefined) return

    updateIngredientMutation.mutate({
      title: formData.title,
      description: formData.description || null,
      unitOfMeasurement: formData.unitOfMeasurement || null,
      baseValue: formData.baseValue,
    })
  }

  const isOpen = !!editId

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
                value={formData.title || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Ingredient name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
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
                value={formData.unitOfMeasurement || 'none'}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    unitOfMeasurement: value === 'none' ? null : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="grams">Grams</SelectItem>
                  <SelectItem value="kilograms">Kilograms</SelectItem>
                  <SelectItem value="ounces">Ounces</SelectItem>
                  <SelectItem value="pounds">Pounds</SelectItem>
                  <SelectItem value="cups">Cups</SelectItem>
                  <SelectItem value="tablespoons">Tablespoons</SelectItem>
                  <SelectItem value="teaspoons">Teaspoons</SelectItem>
                  <SelectItem value="pieces">Pieces</SelectItem>
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
                value={formData.baseValue}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    baseValue: parseFloat(e.target.value) || 0,
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
                disabled={updateIngredientMutation.isPending || !formData.title}
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
