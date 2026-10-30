type DatabaseError = {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
}

/** Keep database diagnostics available while giving existing error UIs an Error. */
export function mutationError(error: DatabaseError, action: string): Error {
  let message = error.message
  if (error.code === '23503') {
    message = `Cannot ${action} because related records still reference it. ` +
      'Keep records with attendance or location history; reassign dependencies before deleting unused records.'
  } else if (error.code === '23505') {
    message = `Cannot ${action} because a record with the same unique value already exists. Refresh and edit the existing record instead.`
  } else if (error.code === '42501') {
    message = `You do not have permission to ${action}. Contact your administrator.`
  }
  return Object.assign(new Error(message), {
    code: error.code,
    details: error.details,
    hint: error.hint,
    databaseMessage: error.message,
  })
}
