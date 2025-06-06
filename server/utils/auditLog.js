/**
 * Logs an action to the audit_log table using a provided database client.
 * @param {object} dbClient - The database client (e.g., from a transaction).
 * @param {number} userId - The ID of the user performing the action.
 * @param {string} action - A description of the action (e.g., 'CREATE_PRODUCT').
 * @param {string} [entity=null] - The type of entity affected (e.g., 'PRODUCT').
 * @param {number} [entityId=null] - The ID of the affected entity.
 */
const logger = require('./logger'); // Import the logger

async function logAction(dbClient, userId, action, entity = null, entityId = null) {
  const queryText = `
    INSERT INTO audit_log (user_id, action, entity, entity_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id;
  `;
  // Parameters are now: dbClient, userId, action, entity, entityId
  // So, for the query, params start from userId.
  const queryParams = [userId, action, entity, entityId];

  try {
    const { rows } = await dbClient.query(queryText, queryParams);
    // logger.debug(`Audit log created with ID: ${rows[0].id}`); // Optional: for debugging
    return rows[0];
  } catch (error) {
    // Construct a more informative error message string for the first argument
    const errorMessage = `Error logging action to audit_log. Action: ${action}, UserID: ${userId}, Entity: ${entity}, EntityID: ${entityId}.`;
    logger.error(errorMessage, error); // Pass the error object as the second argument

    // Re-throw the error so the calling transaction can be rolled back.
    // The caller is responsible for handling the transaction.
    throw error;
  }
}

module.exports = { logAction };
