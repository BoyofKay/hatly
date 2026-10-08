import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * A full-replace ("set") operation, not an incremental add/remove —
 * simpler and race-free to reason about for an Admin-facing form that
 * shows a multi-select of a branch's current subcategories and saves
 * the resulting set as a whole (mirrors how a typical checkbox-list
 * admin UI naturally works). `ArrayMaxSize` is a sane upper bound, not
 * a stated business rule — a branch realistically belongs to a
 * handful of subcategories, never an unbounded list.
 */
export class SetBranchSubcategoriesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  subcategoryIds: string[];
}
