import { createFileRoute } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { faker } from '@faker-js/faker'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
} from '@tanstack/react-table'
import { rankItem } from '@tanstack/match-sorter-utils'
import { desc, asc, sql, count } from 'drizzle-orm'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { ingredients } from '../../db'
import { useDatabase } from '../../db/database-context'
import { EditIngredientModal } from './-edit-ingredient-modal'
import { unitsOfMeasurement } from '../../db/enums'

export const Route = createFileRoute('/ingredients/')({
  component: RouteComponent,
})

interface Ingredient {
  id: number
  title: string
  description: string | null
  unit_of_measurement: string | null
  base_value: number
}

interface TableState {
  page: number
  pageSize: number
  search: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

// Fuzzy filter function
const fuzzyFilter: FilterFn<any> = (row, columnId, value, addMeta) => {
  const itemRank = rankItem(row.getValue(columnId), value)
  addMeta({
    itemRank,
  })
  return itemRank.passed
}

function RouteComponent() {
  const {
    page = 1,
    pageSize = 10,
    search = '',
    sortBy = 'id',
    sortOrder = 'asc',
    edit,
  } = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { db, isInitialized, resetDatabase } = useDatabase()

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState(search || '')

  // Fetch ingredients with server-side pagination
  const {
    data: ingredientsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['ingredients', { page, pageSize }],
    queryFn: async () => {
      if (!db) throw new Error('Database not initialized')

      const offset = (page - 1) * pageSize

      // Simple pagination query
      const query = db.select().from(ingredients).limit(pageSize).offset(offset)

      return await query.all()
    },
    enabled: isInitialized && !!db,
  })

  // Get total count for pagination
  const { data: totalCount = 0 } = useQuery({
    queryKey: ['ingredients-count'],
    queryFn: async () => {
      if (!db) throw new Error('Database not initialized')

      // Use Drizzle's count function for a more idiomatic approach
      const result = await db.select({ count: count() }).from(ingredients).get()

      return result?.count || 0
    },
    enabled: isInitialized && !!db,
  })

  // Add ingredient mutation
  const addIngredientMutation = useMutation({
    mutationFn: async (ingredient: Omit<Ingredient, 'id'>) => {
      if (!db) throw new Error('Database not initialized')
      console.log('inserting ingredient', ingredient)
      return await db.insert(ingredients).values(ingredient).returning()
    },
    onSuccess: () => {
      console.log('invalidating ingredients')
      queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      queryClient.invalidateQueries({ queryKey: ['ingredients-count'] })
    },
  })

  const addRandomIngredient = async () => {
    const randomIngredient = {
      title: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      unit_of_measurement: faker.helpers.arrayElement(unitsOfMeasurement),
      base_value: parseFloat(
        faker.commerce.price({ min: 0.1, max: 100, dec: 2 }),
      ),
    }

    addIngredientMutation.mutate(randomIngredient)
  }

  // Update URL with clean parameters
  const updateURL = (updates: Partial<TableState>) => {
    const newSearch: Partial<TableState> = {}

    // Only include parameters that have meaningful values
    if (updates.page !== undefined && updates.page > 1)
      newSearch.page = updates.page
    if (updates.pageSize !== undefined && updates.pageSize !== 10)
      newSearch.pageSize = updates.pageSize
    if (updates.search !== undefined && updates.search.trim())
      newSearch.search = updates.search.trim()
    if (updates.sortBy !== undefined && updates.sortBy !== 'id')
      newSearch.sortBy = updates.sortBy
    if (updates.sortOrder !== undefined && updates.sortOrder !== 'asc')
      newSearch.sortOrder = updates.sortOrder

    navigate({ search: newSearch, replace: true, resetScroll: false })
  }

  const columns = useMemo<ColumnDef<Ingredient>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'ID',
        cell: (info) => info.getValue(),
        enableSorting: true,
        enableColumnFilter: false,
      },
      {
        accessorKey: 'title',
        header: 'Name',
        cell: (info) => info.getValue(),
        enableSorting: true,
        enableColumnFilter: false,
      },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: (info) => info.getValue() || 'No description',
        enableSorting: true,
        enableColumnFilter: false,
      },
      {
        accessorKey: 'unit_of_measurement',
        header: 'Unit',
        cell: (info) => info.getValue() || 'N/A',
        enableSorting: true,
        enableColumnFilter: false,
      },
      {
        accessorKey: 'base_value',
        header: 'Base Value',
        cell: (info) => `$${Number(info.getValue()).toFixed(2)}`,
        enableSorting: true,
        enableColumnFilter: false,
      },
    ],
    [],
  )

  const table = useReactTable({
    data: ingredientsData || [],
    columns,
    filterFns: {
      fuzzy: fuzzyFilter,
    },
    state: {
      columnFilters,
      globalFilter,
      pagination: {
        pageIndex: page - 1,
        pageSize,
      },
    },
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: (value) => {
      setGlobalFilter(value)
      updateURL({ search: value as string })
    },
    globalFilterFn: 'fuzzy',
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(totalCount / pageSize),
    onPaginationChange: (updater) => {
      const newState =
        typeof updater === 'function'
          ? updater(table.getState().pagination)
          : updater
      const newPage = newState.pageIndex + 1
      const newPageSize = newState.pageSize

      updateURL({
        page: newPage,
        pageSize: newPageSize,
      })
    },
  })

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-red-800 mb-2">
              Database Error
            </h2>
            <p className="text-red-600 mb-4">{error.message}</p>
            <Button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="container mx-auto px-4 py-6 flex-1 flex flex-col overflow-hidden h-full">
        <Card className="flex-1 flex flex-col overflow-hidden ">
          <CardHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl font-bold">
                  Ingredients Manager
                </CardTitle>
                <CardDescription>
                  Manage your ingredients with ease
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={addRandomIngredient}
                  disabled={addIngredientMutation.isPending}
                >
                  {addIngredientMutation.isPending
                    ? 'Adding...'
                    : 'Add Random Ingredient'}
                </Button>
                <Button onClick={resetDatabase} variant="destructive">
                  Reset Database
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Global Search */}
            <div className="mb-4 flex-shrink-0">
              <input
                value={globalFilter ?? ''}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="w-full p-3 bg-muted rounded-lg border border-input focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                placeholder="Search ingredients..."
              />
            </div>

            {/* Table Container */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">
                      Loading ingredients...
                    </p>
                  </div>
                </div>
              ) : ingredientsData?.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-muted-foreground text-lg">
                    {globalFilter
                      ? 'No ingredients found matching your search.'
                      : 'No ingredients yet. Click the button above to add some!'}
                  </p>
                </div>
              ) : (
                <>
                  {/* Table */}
                  <div className="flex-1 overflow-auto min-h-0">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        {table.getHeaderGroups().map((headerGroup) => (
                          <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                              <th
                                key={header.id}
                                colSpan={header.colSpan}
                                className="px-4 py-3 text-left font-medium bg-muted/50"
                              >
                                {header.isPlaceholder ? null : (
                                  <div
                                    {...{
                                      className: header.column.getCanSort()
                                        ? 'cursor-pointer select-none hover:text-primary transition-colors'
                                        : '',
                                      onClick:
                                        header.column.getToggleSortingHandler(),
                                    }}
                                  >
                                    {flexRender(
                                      header.column.columnDef.header,
                                      header.getContext(),
                                    )}
                                    {{
                                      asc: ' 🔼',
                                      desc: ' 🔽',
                                    }[header.column.getIsSorted() as string] ??
                                      null}
                                  </div>
                                )}
                              </th>
                            ))}
                          </tr>
                        ))}
                      </thead>
                      <tbody className="divide-y divide-border">
                        {table.getRowModel().rows.map((row) => (
                          <tr
                            key={row.id}
                            className="hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => {
                              const ingredient = row.original
                              navigate({
                                search: (prev: any) => ({
                                  ...prev,
                                  edit: ingredient.id,
                                }),
                              })
                            }}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <td key={cell.id} className="px-4 py-3">
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext(),
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex-shrink-0">
            {/* Pagination */}
            <div className="w-full">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="px-3 py-1 bg-secondary rounded-md hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                >
                  {'<<'}
                </button>
                <button
                  className="px-3 py-1 bg-secondary rounded-md hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  {'<'}
                </button>
                <button
                  className="px-3 py-1 bg-secondary rounded-md hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  {'>'}
                </button>
                <button
                  className="px-3 py-1 bg-secondary rounded-md hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                >
                  {'>>'}
                </button>
                <span className="flex items-center gap-1">
                  <div>Page</div>
                  <strong>
                    {page} of {Math.ceil(totalCount / pageSize)}
                  </strong>
                </span>
                <span className="flex items-center gap-1">
                  | Go to page:
                  <input
                    type="number"
                    defaultValue={table.getState().pagination.pageIndex + 1}
                    onChange={(e) => {
                      const page = e.target.value
                        ? Number(e.target.value) - 1
                        : 0
                      table.setPageIndex(page)
                    }}
                    className="w-16 px-2 py-1 bg-muted rounded-md border border-input focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                  />
                </span>
                <select
                  value={table.getState().pagination.pageSize}
                  onChange={(e) => {
                    table.setPageSize(Number(e.target.value))
                  }}
                  className="px-2 py-1 bg-muted rounded-md border border-input focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                >
                  {[5, 10, 20, 50].map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      Show {pageSize}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {totalCount} total ingredients
              </div>
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* Edit Ingredient Modal */}
      <EditIngredientModal
        editId={edit ? Number(edit) : null}
        onClose={() => {
          navigate({ search: (prev: any) => ({ ...prev, edit: undefined }) })
        }}
      />
    </div>
  )
}
