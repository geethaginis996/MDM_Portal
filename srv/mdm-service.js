// =============================================================================
//  SAP MDM Portal — Service Implementation
// =============================================================================

const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');

// Width of the zero-padded running sequence used for CR IDs, e.g. "0000000001".
// 10 digits comfortably supports up to 9,999,999,999 requests; the column
// itself (CRHeader.cr_id, String(20)) has headroom well beyond that if the
// sequence ever needs to grow past this width — padStart below simply stops
// padding once the number itself is longer than SEQ_WIDTH digits.
const SEQ_WIDTH = 10;

/**
 * Generates the next sequential Change Request ID as a single global,
 * zero-padded running number — no category or year prefix (e.g. "0000000001",
 * "0000000002", ...). All change requests share one sequence regardless of
 * category, so IDs stay strictly increasing and sortable over the life of
 * the system.
 *
 * Reads the highest existing purely-numeric cr_id and increments it —
 * wrapped in a retry loop by the caller to stay safe under concurrent
 * requests (SQLite has no native sequence object, so we rely on optimistic
 * retry on a unique-key violation). Rows left over from the old
 * "CR-{CAT}-{YYYY}-{NNNNNN}" format are simply ignored by the numeric-only
 * filter, so the new sequence starts clean at 1 alongside any legacy data.
 */
async function generateNextCrId(db) {
    // .where() is parsed as CDS query language (CQL), not raw SQL, so
    // SQLite-specific operators like GLOB can't be pushed down there.
    // Instead, read every cr_id (just that one column, so this stays cheap
    // even as the table grows) and compute the numeric max in JS — this
    // also naturally ignores old prefixed IDs like "CR-ORG-2026-000001",
    // since they simply fail the /^\d+$/ numeric test below.
    const aExisting = await db.run(
        SELECT.from('mdm.portal.CRHeader').columns('cr_id')
    );

    let iMax = 0;
    (aExisting || []).forEach(function (r) {
        if (r.cr_id && /^\d+$/.test(r.cr_id)) {
            const iVal = parseInt(r.cr_id, 10);
            if (iVal > iMax) { iMax = iVal; }
        }
    });

    return String(iMax + 1).padStart(SEQ_WIDTH, '0');
}

class MDMPortalService extends cds.ApplicationService {
    async init() {

        // Connects to SAP Build Process Automation using the binding set up
        // via `cds bind` locally (Destination service instance), and via the
        // deployed service binding once running on BTP.
        this.workflow = await cds.connect.to('workflow');

        // =====================================================================
        //  CHANGE REQUEST ACTIONS
        // =====================================================================

        /**
         * Submit a change request for approval
         * - Validates CR data
         * - Determines release strategy
         * - Creates initial release strategy snapshot
         * - Changes CR status to IN_APPROVAL
         */
        // =====================================================================
        //  DELETE / CANCEL CHANGE REQUEST
        //  DRAFT     → hard delete: removes CRHeader + all child rows (cascade)
        //  IN_APPROVAL → soft cancel: sets status = CANCELLED
        //  APPROVED / POSTED → not allowed
        // =====================================================================
        // =====================================================================
        //  SAVE CR ATTACHMENTS
        //  Saves file metadata for documents attached to a Change Request.
        //  The actual file bytes are handled client-side (e.g. stored in
        //  localStorage / IndexedDB or a future object store); this saves
        //  the metadata record so the detail view can list the attachments.
        // =====================================================================
        this.on('SaveCRAttachments', async (req) => {
            const { cr_id, attachments = [] } = req.data;
            if (!cr_id)              { return req.error(400, 'cr_id is required'); }
            if (!attachments.length) { return { success: true, message: 'No attachments to save.', saved: 0 }; }

            const actor = req.user?.id || 'system';
            const dNow  = new Date().toISOString();

            // Verify CR exists
            const cr = await SELECT.one.from('mdm.portal.CRHeader').where({ cr_id });
            if (!cr) { return req.error(404, `Change request ${cr_id} not found`); }

            // Delete existing attachments before re-inserting — prevents duplicates
            // when Save Draft is clicked multiple times on the same draft.
            await DELETE.from('mdm.portal.CRAttachment').where({ cr_cr_id: cr_id });

            const aRows = attachments.map(a => ({
                attachment_id    : uuid(),       // uses the uuid package imported at top of file
                cr_cr_id         : cr_id,
                file_name        : a.file_name        || 'unknown',
                mime_type        : a.mime_type        || 'application/octet-stream',
                size_bytes       : a.size_bytes       || 0,
                object_store_uri : a.object_store_uri || '',
                description      : a.description      || '',
                uploaded_by      : actor,
                uploaded_at      : dNow,
                createdAt        : dNow,
                createdBy        : actor,
                modifiedAt       : dNow,
                modifiedBy       : actor
            }));

            await INSERT.into('mdm.portal.CRAttachment').entries(aRows);
            console.log(`[SaveCRAttachments] saved ${aRows.length} row(s) for ${cr_id}`);
            return { success: true, message: `${aRows.length} attachment(s) saved.`, saved: aRows.length };
        });

        this.on('DeleteChangeRequest', async (req) => {
            const { cr_id, reason } = req.data;
            const db = cds.db;

            if (!cr_id) { return req.error(400, 'cr_id is required'); }

            // Use explicit WHERE — db.read(entity, key) only works with default 'ID' key
            const cr = await SELECT.one.from('mdm.portal.CRHeader')
                .where({ cr_id: cr_id });
            if (!cr) { return req.error(404, `Change request ${cr_id} not found`); }

            const { status } = cr;

            if (status === 'APPROVED' || status === 'POSTED') {
                return req.error(400,
                    `Cannot delete a ${status} request. Only DRAFT or IN_APPROVAL requests can be removed.`
                );
            }

            if (status === 'DRAFT') {
                // Hard delete — delete children first to satisfy FK constraints,
                // then delete the header
                await DELETE.from('mdm.portal.CRFieldValue')
                    .where({ cr_cr_id: cr_id });
                await DELETE.from('mdm.portal.CRBPRole')
                    .where({ cr_cr_id: cr_id });
                await DELETE.from('mdm.portal.CRAttachment')
                    .where({ cr_cr_id: cr_id });
                await DELETE.from('mdm.portal.CRHeader')
                    .where({ cr_id: cr_id });
                return { success: true, message: `Draft ${cr_id} deleted.` };
            }

            if (status === 'IN_APPROVAL' || status === 'SENT_BACK' || status === 'CANCELLED') {
                // Soft cancel — keep data for audit trail, just update status
                await UPDATE('mdm.portal.CRHeader')
                    .set({ status: 'CANCELLED' })
                    .where({ cr_id: cr_id });
                return { success: true, message: `Request ${cr_id} cancelled.` };
            }

            return req.error(400, `Cannot remove a request with status ${status}`);
        });

        this.on('submitChangeRequest', async (req) => {
            const { cr_id } = req.data;
            const db = cds.db;

            try {
                // Fetch CR
                const cr = await SELECT.one.from('mdm.portal.CRHeader').where({ cr_id: cr_id });
                if (!cr) {
                    return req.error(404, `Change Request ${cr_id} not found`);
                }

                if (cr.status !== 'DRAFT') {
                    return req.error(400, `Cannot submit CR in ${cr.status} status`);
                }

                // Validate required fields
                if (!cr.scenario_code || !cr.master_data_type_master_data_type_id) {
                    return req.error(400, 'Scenario Code and Master Data Type are required');
                }

                // Fetch field values to determine strategy. CRFieldValue.cr
                // (Association to CRHeader) flattens to cr_cr_id, and its
                // field association flattens to field_field_id — confirmed
                // via `cds compile ... --to sql`. Also: db.read(entity, fn)
                // with a callback calling q.where(...) inside is NOT valid
                // here and throws a confusing "where not found in the
                // elements of ..." error — the working form is
                // db.read(entity).where(...), chained directly (see
                // ValidateField/GetFieldsByMasterDataType above for the
                // already-correct usage of this same pattern).
                const fieldValues = await db.read('mdm.portal.CRFieldValue')
                    .where({ cr_cr_id: cr_id });

                // Call function to determine strategy
                const strategyResult = await this.determineReleaseStrategy(
                    cr.master_data_type_master_data_type_id,
                    cr.scenario_code,
                    fieldValues.map((fv) => ({
                        characteristic_id: fv.field_field_id,
                        value: fv.new_value,
                    }))
                );

                if (!strategyResult || !strategyResult.strategy_id) {
                    return req.error(400, 'No matching release strategy found');
                }

                // Update CR status. CRHeader.strategy is an association to
                // ReleaseStrategy, which has a COMPOSITE key (strategy_id +
                // master_data_type) — there is no plain "strategy_id" column
                // to set directly. Set both flattened key parts instead,
                // using the CR's own master_data_type as the strategy's
                // scope (a strategy is defined per master data type).
                // NOTE: db.update(entity, scalarValue) only works when the
                // entity's key is literally named "ID" — CRHeader's key is
                // "cr_id", so an explicit .where() is required (same gotcha
                // already flagged in DeleteChangeRequest above).
                await db.update('mdm.portal.CRHeader').where({ cr_id }).set({
                    status: 'IN_APPROVAL',
                    submitted_at: new Date(),
                    strategy_strategy_id: strategyResult.strategy_id,
                    strategy_master_data_type_master_data_type_id: cr.master_data_type_master_data_type_id,
                });

                // Create release strategy snapshot
                await this.createReleaseStrategySnapshot(
                    cr_id,
                    strategyResult.strategy_id
                );

                // Notify SAP Build Process Automation so the first approver
                // gets a task in their Inbox. This does NOT replace the
                // CRReleaseStep tracking above — CRReleaseStep/CRHeader.status
                // remain the source of truth for the Fiori UI. If this call
                // fails, don't block the CR submission; just log it.
                await this._triggerApprovalWorkflow(cr_id, strategyResult.strategy_id, req.user.id);

                // Audit log
                await this.createAuditLog('CR_HEADER', cr_id, 'SUBMIT', req.user.id);

                return {
                    success: true,
                    message: `Change Request ${cr_id} submitted for approval`,
                    strategy_id: strategyResult.strategy_id,
                };
            } catch (error) {
                console.error('submitChangeRequest error:', error);
                return req.error(500, `Failed to submit CR: ${error.message}`);
            }
        });

        /**
         * Approve/Reject a release step
         */
        this.on('approveReleaseStep', async (req) => {
            const { cr_id, step_number, comment, action } = req.data;
            const db = cds.db;

            try {
                // CRReleaseStrategy's only key is "cr" (Association to
                // CRHeader), which flattens to cr_cr_id — confirmed via
                // `cds compile db/data-model.cds --to sql --dialect sqlite`.
                const crReleaseStrat = await SELECT.one.from('mdm.portal.CRReleaseStrategy')
                    .where({ cr_cr_id: cr_id });

                if (!crReleaseStrat) {
                    return req.error(404, `No release strategy for CR ${cr_id}`);
                }

                // CRReleaseStep.cr (Association to CRReleaseStrategy, whose
                // own key "cr" is itself an association to CRHeader.cr_id)
                // flattens two levels deep to cr_cr_cr_id — NOT "cr_id".
                // Note: if this step has multiple parallel approvers
                // (differentiated by sequence_within_step), this action's
                // signature has no way to target one specifically — it acts
                // on the first match. That's a pre-existing design gap, not
                // introduced by this fix.
                const step = await SELECT.one.from('mdm.portal.CRReleaseStep')
                    .where({ cr_cr_cr_id: cr_id, step_number });

                if (!step) {
                    return req.error(404, `Step ${step_number} not found`);
                }

                const validActions = ['APPROVE', 'REJECT', 'SEND_BACK'];
                if (!validActions.includes(action)) {
                    return req.error(400, `Invalid action: ${action}`);
                }

                // Update step — previously this UPDATE had NO WHERE clause
                // at all, which would have updated every row in
                // CRReleaseStep on every single approve/reject click. Scope
                // it to exactly the row just read above.
                await db.update('mdm.portal.CRReleaseStep')
                    .where({
                        cr_cr_cr_id: cr_id,
                        step_number,
                        sequence_within_step: step.sequence_within_step
                    })
                    .set({
                        status:
                            action === 'APPROVE'
                                ? 'APPROVED'
                                : action === 'REJECT'
                                    ? 'REJECTED'
                                    : 'SENT_BACK',
                        acted_by: req.user.id,
                        acted_at: new Date(),
                        comment,
                    });

                // Record decision
                await db.run(
                    INSERT.into('mdm.portal.CRApprovalDecision').entries([
                        {
                            decision_id: uuid(),
                            cr_cr_id: cr_id,
                            step_number,
                            sequence_within_step: step.sequence_within_step,
                            release_code_release_code_id: step.release_code_release_code_id,
                            action,
                            acted_by: req.user.id,
                            acted_at: new Date(),
                            comment,
                        },
                    ])
                );

                // Update CR status based on action. db.update(entity, scalarValue)
                // only works when the key is literally named "ID" — CRHeader's
                // key is "cr_id", so use an explicit .where() here too.
                if (action === 'REJECT') {
                    await db.update('mdm.portal.CRHeader').where({ cr_id }).set({
                        status: 'REJECTED',
                    });
                } else if (action === 'SEND_BACK') {
                    await db.update('mdm.portal.CRHeader').where({ cr_id }).set({
                        status: 'SENT_BACK',
                    });
                } else if (action === 'APPROVE') {
                    // Check if all steps are approved. db.read(entity, fn)
                    // with a callback isn't valid here (same issue fixed
                    // above in the fieldValues read) — chain .where() on
                    // the return value instead.
                    const remainingSteps = await db.read('mdm.portal.CRReleaseStep')
                        .where({
                            cr_cr_cr_id: cr_id,
                            status: { '!=': 'APPROVED' },
                        });

                    if (remainingSteps.length === 0) {
                        await db.update('mdm.portal.CRHeader').where({ cr_id }).set({
                            status: 'APPROVED',
                        });
                    }
                }

                // Audit log
                await this.createAuditLog(
                    'CR_RELEASE_STEP',
                    `${cr_id}#${step_number}`,
                    action,
                    req.user.id
                );

                return {
                    success: true,
                    message: `Step ${step_number} ${action.toLowerCase()}ed`,
                    next_step: step_number + 1,
                };
            } catch (error) {
                console.error('approveReleaseStep error:', error);
                return req.error(500, `Failed to approve step: ${error.message}`);
            }
        });

        /**
         * Post an approved change request to SAP
         */
        this.on('postChangeRequest', async (req) => {
            const { cr_id } = req.data;
            const db = cds.db;

            try {
                const cr = await SELECT.one.from('mdm.portal.CRHeader').where({ cr_id: cr_id });

                if (!cr) {
                    return req.error(404, `CR ${cr_id} not found`);
                }

                if (cr.status !== 'APPROVED') {
                    return req.error(
                        400,
                        `Cannot post CR in ${cr.status} status. Must be APPROVED.`
                    );
                }

                // TODO: Call SAP RFC / API to post the change request
                const postedObjectNo = await this.postToSAP(cr);

                if (!postedObjectNo) {
                    return req.error(500, 'Failed to post to SAP');
                }

                // Update CR — CRHeader's key is "cr_id", not the default
                // "ID" that db.update(entity, scalarValue) assumes, so an
                // explicit .where() is required.
                await db.update('mdm.portal.CRHeader').where({ cr_id }).set({
                    status: 'POSTED',
                    posted_object_no: postedObjectNo,
                    posted_at: new Date(),
                });

                // Audit log
                await this.createAuditLog('CR_HEADER', cr_id, 'POST', req.user.id);

                return {
                    success: true,
                    message: `Change Request posted successfully`,
                    posted_object_no: postedObjectNo,
                };
            } catch (error) {
                console.error('postChangeRequest error:', error);

                // Update CR status to POSTING_FAILED
                await db
                    .update('mdm.portal.CRHeader')
                    .where({ cr_id })
                    .set({ status: 'POSTING_FAILED' });

                return req.error(500, `Failed to post CR: ${error.message}`);
            }
        });

        this.on('ValidateField', async (req) => {
            const { field_id, value } = req.data;
            const db = cds.db;

            try {
                const field = await db.read('mdm.portal.FieldMaster')
                    .where({ field_id });

                if (!field || field.length === 0) {
                    return {
                        isValid: false,
                        errorMessage: `Field ${field_id} not found`
                    };
                }

                const f = field[0];

                // Basic type validation
                let isValid = true;
                let errorMessage = "";

                switch (f.data_type) {
                    case "INTEGER":
                        isValid = /^-?\d+$/.test(value);
                        errorMessage = isValid ? "" : "Must be an integer";
                        break;
                    case "DECIMAL":
                        isValid = /^-?\d+(\.\d+)?$/.test(value);
                        errorMessage = isValid ? "" : "Must be a decimal number";
                        break;
                    case "DATE":
                        isValid = /^\d{4}-\d{2}-\d{2}$/.test(value);
                        errorMessage = isValid ? "" : "Must be YYYY-MM-DD format";
                        break;
                    case "STRING":
                        isValid = value.length <= (f.length || 255);
                        errorMessage = isValid ? "" : `Exceeds max length of ${f.length}`;
                        break;
                }

                return {
                    isValid,
                    errorMessage
                };
            } catch (error) {
                return {
                    isValid: false,
                    errorMessage: `Validation error: ${error.message}`
                };
            }
        });
        this.on('GetFieldsByMasterDataType', async (req) => {
            const { masterDataTypeId } = req.data;
            const db = cds.db;

            try {
                const fields = await db.read('mdm.portal.FieldMaster')
                    .where({
                        master_data_type_id: masterDataTypeId,
                        active: true
                    });

                return fields;
            } catch (error) {
                return req.error(500, `Error fetching fields: ${error.message}`);
            }
        });


        this.on('BulkDeleteFields', async (req) => {
            const { fieldIds } = req.data;
            let deleted = 0;
            let failed = 0;

            for (const field_id of fieldIds) {
                try {
                    // Check if field is in use
                    const aBPRoles = await SELECT.from('mdm.portal.BPRoleField')
                        .where({ field_id: field_id });

                    if (aBPRoles.length > 0) {
                        failed++;
                        continue;
                    }

                    await DELETE.from(db.entity('mdm.portal.FieldMaster'))
                        .where({ field_id: field_id });
                    deleted++;
                } catch (error) {
                    console.error(`Failed to delete ${field_id}:`, error);
                    failed++;
                }
            }

            return {
                success: failed === 0,
                deleted: deleted,
                failed: failed
            };
        });



        this.on('DeleteField', async (req) => {
            const { field_id } = req.data;

            try {
                // Check if field is used in any BPRole or BPCategory
                const aBPRoles = await SELECT.from('mdm.portal.BPRoleField')
                    .where({ field_id: field_id });

                if (aBPRoles.length > 0) {
                    return {
                        success: false,
                        message: `Field ${field_id} is used in ${aBPRoles.length} BP Role(s). Cannot delete.`
                    };
                }

                // Delete the field
                await DELETE.from(db.entity('mdm.portal.FieldMaster'))
                    .where({ field_id: field_id });

                // Log audit
                await INSERT.into('mdm.portal.AuditLog').entries({
                    entity_name: 'FieldMaster',
                    entity_key: field_id,
                    action: 'DELETE',
                    actor: req.user.id,
                    acted_at: new Date(),
                    correlation_id: req.headers['x-correlation-id']
                });

                return {
                    success: true,
                    message: `Field ${field_id} deleted successfully`
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Error deleting field: ${error.message}`
                };
            }
        });


        this.on('BulkActivateFields', async (req) => {
            const { fieldIds } = req.data;
            let activated = 0;
            let failed = 0;

            for (const field_id of fieldIds) {
                try {
                    await UPDATE(db.entity('mdm.portal.FieldMaster')).set({ active: true })
                        .where({ field_id: field_id });
                    activated++;
                } catch (error) {
                    console.error(`Failed to activate ${field_id}:`, error);
                    failed++;
                }
            }

            return {
                success: failed === 0,
                activated: activated,
                failed: failed
            };
        });


        this.on('ActivateField', async (req) => {
            const { field_id } = req.data;

            try {
                // Update field to active
                await UPDATE(db.entity('mdm.portal.FieldMaster')).set({ active: true })
                    .where({ field_id: field_id });

                // Log audit trail
                await INSERT.into('mdm.portal.AuditLog').entries({
                    entity_name: 'FieldMaster',
                    entity_key: field_id,
                    action: 'UPDATE',
                    actor: req.user.id,
                    acted_at: new Date(),
                    before_value: JSON.stringify({ active: false }),
                    after_value: JSON.stringify({ active: true }),
                    correlation_id: req.headers['x-correlation-id']
                });

                return {
                    success: true,
                    message: `Field ${field_id} activated successfully`
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Error activating field: ${error.message}`
                };
            }
        });

        // =====================================================================
        //  READ OPERATIONS / FUNCTIONS
        // =====================================================================

        this.on('READ', 'ChangeRequests', async (req) => {
            // Add custom authorization checks, etc.
            return await cds.run(req.query);
        });

        this.on('CREATE', 'ChangeRequests', async (req) => {
            const { data } = req;

            // Set defaults
            data.cr_id = data.cr_id || await generateNextCrId(cds.db);
            data.status = 'DRAFT';
            data.requester = req.user.id;

            await cds.run(INSERT.into('mdm.portal.CRHeader').entries([data]));
        });

        // =====================================================================
        //  HELPER FUNCTIONS
        // =====================================================================

        this.determineReleaseStrategy = async function (
            masterDataTypeId,
            scenarioCode,
            values
        ) {
            // TODO: Full implementation should match `values` against each
            // active strategy's StrategyCharacteristicValue rows (per the
            // Release Strategy Configuration table design — OR within a
            // characteristic, AND across characteristics) and pick the one
            // strategy whose criteria the CR satisfies. Until that matching
            // logic exists, fall back to the lowest-priority ACTIVE strategy
            // for the given master data type (the seed data's "Fallback"
            // entries use a high priority number for exactly this reason) —
            // this at least returns a real, existing strategy_id instead of
            // a hardcoded one ("STRAT-001") that doesn't exist in the data.
            const db = cds.db;
            const strategy = await SELECT.one.from('mdm.portal.ReleaseStrategy')
                .where({ master_data_type_master_data_type_id: masterDataTypeId, active: true })
                .orderBy('priority');

            if (!strategy) {
                return null;
            }

            const steps = await SELECT.from('mdm.portal.ReleaseStrategyStep')
                .where({ strategy_strategy_id: strategy.strategy_id });

            return {
                strategy_id: strategy.strategy_id,
                steps_count: steps.length,
                estimated_duration_hours: null // not computed yet — would need to sum each step's release code SLA
            };
        };

        this.createReleaseStrategySnapshot = async function (crId, strategyId) {
            const db = cds.db;
            const strategy = await SELECT.one.from('mdm.portal.ReleaseStrategy').where({ strategy_id: strategyId });

            if (!strategy) return;

            const sMdt = strategy.master_data_type_master_data_type_id;

            // Column names below are the ACTUAL flattened foreign keys
            // generated from the CDS associations (confirmed via
            // `cds compile db/data-model.cds --to sql --dialect sqlite`) —
            // NOT the plain "cr_id" / "strategy_id" used here previously,
            // which don't exist as real columns:
            //   CRReleaseStrategy.cr        (Association to CRHeader)        -> cr_cr_id
            //   CRReleaseStrategy.strategy  (Association to ReleaseStrategy,
            //                                 composite key) -> strategy_strategy_id
            //                                 + strategy_master_data_type_master_data_type_id
            await db.run(
                INSERT.into('mdm.portal.CRReleaseStrategy').entries([
                    {
                        cr_cr_id: crId,
                        strategy_strategy_id: strategyId,
                        strategy_master_data_type_master_data_type_id: sMdt,
                        determined_at: new Date(),
                        overall_status: 'IN_PROGRESS',
                        current_step: 1,
                    },
                ])
            );

            // ReleaseStrategyStep.strategy is the same composite association,
            // so both key parts are needed in the filter too. db.read(entity, fn)
            // with a callback isn't valid here (same issue fixed in
            // submitChangeRequest/approveReleaseStep) — chain .where() on
            // the return value instead.
            const steps = await db.read('mdm.portal.ReleaseStrategyStep')
                .where({
                    strategy_strategy_id: strategyId,
                    strategy_master_data_type_master_data_type_id: sMdt
                });

            for (const step of steps) {
                // CRReleaseStep.cr (Association to CRReleaseStrategy, whose
                // own key "cr" is itself an association to CRHeader.cr_id)
                // flattens two levels deep to cr_cr_cr_id. The step's own
                // release_code association flattens to
                // release_code_release_code_id, not "release_code_id".
                await db.run(
                    INSERT.into('mdm.portal.CRReleaseStep').entries([
                        {
                            cr_cr_cr_id: crId,
                            step_number: step.step_number,
                            sequence_within_step: 1,
                            release_code_release_code_id: step.release_code_release_code_id,
                            status: 'PENDING',
                        },
                    ])
                );
            }
        };

        this.postToSAP = async function (cr) {
            // TODO: Implement SAP posting logic
            // - Call RFC or REST API
            // - Handle errors
            return `BP-${Date.now()}`;
        };

        // Looks up the real approver for a CR's first release step, via
        // ReleaseCodeUser (the users/groups actively assigned to that
        // step's release code). Falls back to fallbackId if no step or no
        // active approver exists yet — this covers SaveBPChangeRequest's
        // submit path, which doesn't create CRReleaseStep rows (it never
        // calls determineReleaseStrategy/createReleaseStrategySnapshot —
        // a separate, already-flagged gap), so it always falls back today.
        // If a release code has multiple active users assigned, this just
        // takes the first one — a real design might notify all of them,
        // or define a single "primary" approver concept instead.
        this._lookupApproverForCr = async function (crId, fallbackId) {
            try {
                const step = await SELECT.one.from('mdm.portal.CRReleaseStep')
                    .where({ cr_cr_cr_id: crId })
                    .orderBy('step_number');

                if (!step || !step.release_code_release_code_id) {
                    return fallbackId;
                }

                const approver = await SELECT.one.from('mdm.portal.ReleaseCodeUser')
                    .where({
                        release_code_release_code_id: step.release_code_release_code_id,
                        active: true
                    });

                return approver ? approver.user_id : fallbackId;
            } catch (e) {
                console.error(`[workflow] Approver lookup failed for CR ${crId}, falling back to requester:`, e.message);
                return fallbackId;
            }
        };

        // Starts a workflow instance in SAP Build Process Automation so the
        // first approver gets a task in their Inbox. Never throws — a
        // failure here (e.g. the workflow definition isn't published yet,
        // or the destination/credentials are wrong) must never block the
        // CR submission itself, since CRReleaseStep/CRHeader.status remain
        // the actual source of truth for this app's own approval UI.
        // strategyId may be null (e.g. when called from a path that hasn't
        // determined a release strategy) — BPA just receives it as null.
        //
        // The definitionId below is BPA's own generated ID for the
        // "CR_Approval" process (confirmed via the workflow-definitions
        // API) — NOT a name you choose yourself. It's tied to this specific
        // BTP tenant/project (us10.mdm-portal-nd2mtjke.mdmportalapproval),
        // so it WILL need updating if this project is ever redeployed to a
        // different subaccount, or if the process is released as a new
        // major version under a different project ID.
        this._triggerApprovalWorkflow = async function (crId, strategyId, requesterId) {
            try {
                const sApproverEmail = await this._lookupApproverForCr(crId, requesterId);

                await this.workflow.send({
                    method: 'POST',
                    path: '/public/workflow/rest/v1/workflow-instances',
                    data: {
                        definitionId: 'us10.mdm-portal-nd2mtjke.mdmportalapproval.cR_Approval',
                        // Field names/casing here MUST match the workflow's
                        // own Context type exactly (confirmed from the
                        // Trigger node's Outputs tab in BPA Studio):
                        // cr_id, Strategy_id (capital S), approverEmail.
                        // There is no "requester" field in this workflow's
                        // schema at all.
                        context: {
                            cr_id: crId,
                            Strategy_id: strategyId,
                            approverEmail: sApproverEmail
                        }
                    }
                });
                console.log(`[workflow] Started BPA workflow instance for CR ${crId} (approver: ${sApproverEmail})`);
            } catch (workflowError) {
                // Logged with as much detail as the error object exposes —
                // a 404 (workflow definition not published yet) looks very
                // different from a 401 (bad destination credentials), and
                // only the status/body distinguishes them.
                console.error(
                    `[workflow] Failed to start BPA workflow for ${crId}:`,
                    workflowError.message,
                    workflowError.response?.status,
                    workflowError.response?.data
                );
            }
        };

        this.createAuditLog = async function (
            entityName,
            entityKey,
            action,
            actor,
            beforeValue,
            afterValue
        ) {
            const db = cds.db;
            await db.run(
                INSERT.into('mdm.portal.AuditLog').entries([
                    {
                        audit_id    : uuid(),
                        entity_name : entityName,
                        entity_key  : entityKey,
                        action,
                        actor,
                        acted_at    : new Date(),
                        before_value: beforeValue ? JSON.stringify(beforeValue) : null,
                        after_value : afterValue  ? JSON.stringify(afterValue)  : null
                    },
                ])
            );
        };

        // =====================================================================
        //  AUDIT HOOKS — FieldMaster, FieldGroup, BPCategory, BPRole,
        //  StrategyCharacteristic, ReleaseStrategy
        //  Writes a row to AuditLog on every CREATE, UPDATE, DELETE so that
        //  the Change Log tab on each detail screen shows a full history.
        //  "key" may be a single field name (existing entities) or an array
        //  of field names for composite keys (StrategyCharacteristic /
        //  ReleaseStrategy both key on id + master_data_type) — entity_key
        //  is then the key values joined with "::".
        // =====================================================================

        const AUDIT_ENTITIES = [
            { entity: 'FieldMasters',  name: 'FieldMaster',  key: 'field_id'         },
            { entity: 'FieldGroups',   name: 'FieldGroup',   key: 'group_id'         },
            { entity: 'BPCategories',  name: 'BPCategory',   key: 'category_id'      },
            { entity: 'BPRoles',       name: 'BPRole',       key: 'role_id'          },
            { entity: 'ReleaseCodes',  name: 'ReleaseCode',  key: 'release_code_id'  },
            { entity: 'StrategyCharacteristics', name: 'StrategyCharacteristic',
              key: ['characteristic_id', 'master_data_type_master_data_type_id'] },
            { entity: 'ReleaseStrategies', name: 'ReleaseStrategy',
              key: ['strategy_id', 'master_data_type_master_data_type_id'] },
        ];

        function auditKeyFields(cfg) {
            return Array.isArray(cfg.key) ? cfg.key : [cfg.key];
        }
        // Builds the single entity_key string from any object holding the
        // key field(s) — degrades to the exact previous single-key
        // behavior (just the raw value, no separator) when cfg.key is a
        // plain string, so existing entities are unaffected.
        // CAP's after('CREATE', ...) handler can pass `data` as either a
        // plain object (single insert) or an array of created records
        // (confirmed via live testing) — normalize to a single object
        // before doing anything else with it.
        function auditNormalizeData(data) {
            if (Array.isArray(data)) { return data[0] || null; }
            return data || null;
        }
        function auditBuildKey(cfg, oSource) {
            if (!oSource) { return ''; }
            return auditKeyFields(cfg).map((k) => {
                const v = oSource[k];
                return (v !== undefined && v !== null) ? String(v) : '';
            }).join('::');
        }
        function auditBuildWhere(cfg, oSource) {
            const oWhere = {};
            auditKeyFields(cfg).forEach((k) => { oWhere[k] = oSource ? oSource[k] : undefined; });
            return oWhere;
        }
        function auditHasAllKeys(cfg, oSource) {
            return oSource && auditKeyFields(cfg).every((k) => oSource[k] !== undefined && oSource[k] !== null);
        }
        // For composite keys, CAP typically provides all key fields as an
        // object in req.params[0]; for single keys it's often just the raw
        // scalar. This normalizes both shapes into a lookup object.
        function auditKeySource(cfg, req, fallbackData) {
            const oParam0 = req.params && req.params[0];
            if (oParam0 && typeof oParam0 === 'object' && auditHasAllKeys(cfg, oParam0)) {
                return oParam0;
            }
            if (auditHasAllKeys(cfg, req.data)) { return req.data; }
            if (auditHasAllKeys(cfg, fallbackData)) { return fallbackData; }
            // Single-key fallback: req.params[0] as a raw scalar (original behavior)
            if (!Array.isArray(cfg.key) && oParam0 !== undefined && oParam0 !== null && typeof oParam0 !== 'object') {
                return { [cfg.key]: oParam0 };
            }
            return null;
        }

        for (const cfg of AUDIT_ENTITIES) {
            // AFTER CREATE
            this.after('CREATE', cfg.entity, async (data, req) => {
                const oData = auditNormalizeData(data);
                const sKey  = auditBuildKey(cfg, oData);
                if (!sKey) return;
                // The raw event payload can be key-fields-only (confirmed
                // via live testing) rather than the full created record —
                // re-read explicitly so the "after" snapshot is complete,
                // the same way the before-snapshot is read for UPDATE.
                let oFull = oData;
                try {
                    const db = cds.db;
                    const aFull = await db.read(`mdm.portal.${cfg.name}`).where(auditBuildWhere(cfg, oData));
                    if (aFull && aFull[0]) { oFull = aFull[0]; }
                } catch (e) { /* fall back to whatever data we already have */ }
                try {
                    await this.createAuditLog(
                        cfg.name, sKey, 'CREATE',
                        req.user?.id || 'system',
                        null, oFull
                    );
                } catch (e) {
                    // Surface failures instead of letting them vanish
                    // silently — testing showed this specific hook can be
                    // intermittently unreliable; if this ever fires in
                    // practice it'll be visible in the server log.
                    console.error(`[audit] Failed to log CREATE for ${cfg.name} (${sKey}):`, e.message);
                }
            });

            // BEFORE UPDATE — read current values for the before snapshot
            this.before('UPDATE', cfg.entity, async (req) => {
                const db = cds.db;
                const oKeySrc = auditKeySource(cfg, req, req.data);
                if (!oKeySrc) return;
                const before = await db.read(`mdm.portal.${cfg.name}`).where(auditBuildWhere(cfg, oKeySrc));
                req._auditBefore = before?.[0] || null;
                req._auditKey = auditBuildKey(cfg, oKeySrc);
            });

            // AFTER UPDATE
            this.after('UPDATE', cfg.entity, async (data, req) => {
                const oData = auditNormalizeData(data) || req.data;
                const sKey  = req._auditKey || auditBuildKey(cfg, auditKeySource(cfg, req, oData));
                if (!sKey) return;
                // Same reasoning as CREATE — re-read the full record so the
                // "after" snapshot isn't just the (possibly partial) PATCH
                // body or a key-fields-only event payload.
                let oFull = oData;
                try {
                    const db = cds.db;
                    const aFull = await db.read(`mdm.portal.${cfg.name}`).where(auditBuildWhere(cfg, oData));
                    if (aFull && aFull[0]) { oFull = aFull[0]; }
                } catch (e) { /* fall back to whatever data we already have */ }
                await this.createAuditLog(
                    cfg.name, sKey, 'UPDATE',
                    req.user?.id || 'system',
                    req._auditBefore || null,
                    oFull
                );
            });

            // BEFORE DELETE — capture the record's final state before it's
            // gone, so the Change Log can show what was actually deleted
            // (this hook didn't exist before at all, for any entity).
            this.before('DELETE', cfg.entity, async (req) => {
                const db = cds.db;
                const oKeySrc = auditKeySource(cfg, req, req.data);
                if (!oKeySrc) return;
                const before = await db.read(`mdm.portal.${cfg.name}`).where(auditBuildWhere(cfg, oKeySrc));
                req._auditBefore = before?.[0] || null;
                req._auditKey = auditBuildKey(cfg, oKeySrc);
            });

            // AFTER DELETE
            this.after('DELETE', cfg.entity, async (data, req) => {
                const sKey = req._auditKey || auditBuildKey(cfg, auditKeySource(cfg, req, req.data));
                await this.createAuditLog(
                    cfg.name, sKey || '', 'DELETE',
                    req.user?.id || 'system',
                    req._auditBefore || null, null
                );
            });
        }

        // =====================================================================
        //  SAVE BP CHANGE REQUEST
        //  Persists Create BP form state to CRHeader + CRBPRole + CRFieldValue.
        //  Called by both "Save Draft" (submit=false) and "Save & Create" (submit=true).
        // =====================================================================
        this.on('SaveBPChangeRequest', async (req) => {
            const db  = cds.db;
            const {
                cr_id: existingCrId,
                request_type,
                bp_category,
                account_group,
                reference_object_no,
                bp_number,
                business_justification,
                priority,
                submit,
                bp_roles     = [],
                field_values = []
            } = req.data;

            const actor   = req.user?.id || 'system';

            // BP Account Group is marked required on the Create BP screen
            // (red asterisk) precisely because everything downstream —
            // Number Range, BP numbering, posting — depends on it. The
            // CRHeader.account_group column itself is nullable at the
            // schema level (so a half-finished draft can still be saved
            // mid-edit without other in-progress fields blocking it), but
            // it must never be silently accepted as blank by this action —
            // that previously let drafts persist with no Account Group at
            // all, which is misleading in My Requests and breaks once that
            // draft is edited and submitted. Enforce it explicitly here.
            if (!account_group) {
                return req.error(400, 'BP Account Group is required.');
            }

            const isNew   = !existingCrId;
            let sCrId     = isNew
                ? await generateNextCrId(cds.db)
                : existingCrId;
            const sStatus   = submit ? 'IN_APPROVAL' : 'DRAFT';
            // CRHeader.priority is a CRPriority enum (NORMAL | HIGH) — guard
            // against anything else coming in from the client and fall back
            // to the schema default.
            const sPriority = (priority === 'HIGH') ? 'HIGH' : 'NORMAL';
            // CRHeader uses the @sap/cds/common `managed` aspect, which
            // normally auto-fills createdAt/createdBy/modifiedAt/modifiedBy.
            // That auto-fill only runs for requests CAP dispatches through
            // its own CREATE/UPDATE event pipeline for the entity — this
            // handler instead does a raw INSERT.into(...), which bypasses
            // that pipeline entirely, so those columns are left NULL unless
            // set explicitly here (this previously left "Created On" blank
            // in My Requests for every CR saved through this action).
            const dNow = new Date();

            try {
                if (isNew) {
                    // ── INSERT new CRHeader ──────────────────────────────
                    // Retry once on a (very rare) primary-key collision —
                    // two near-simultaneous saves could read the same "last
                    // sequence" value before either commits. On collision,
                    // re-derive the next sequence and retry exactly once.
                    let bInserted = false;
                    for (let iAttempt = 0; iAttempt < 2 && !bInserted; iAttempt++) {
                        try {
                            await INSERT.into('mdm.portal.CRHeader').entries({
                                cr_id                             : sCrId,
                                cr_group_id                       : sCrId,        // group = CR itself for now
                                request_type                      : request_type || 'CREATE',
                                master_data_type_master_data_type_id: 'BUSINESS PARTNER',
                                scenario_code                     : 'BP_CREATE',
                                bp_category_category_id           : bp_category    || null,
                                account_group_account_group_id    : account_group  || null,
                                reference_object_no               : reference_object_no || null,
                                requester                         : actor,
                                priority                          : sPriority,
                                business_justification            : business_justification || null,
                                status                            : sStatus,
                                submitted_at                      : submit ? dNow : null,
                                createdAt                         : dNow,
                                createdBy                         : actor,
                                modifiedAt                        : dNow,
                                modifiedBy                        : actor
                            });
                            bInserted = true;
                        } catch (eInsert) {
                            const sMsg = String(eInsert && eInsert.message || '').toLowerCase();
                            const bIsDupKey = sMsg.includes('unique') || sMsg.includes('constraint') || sMsg.includes('primary key');
                            if (bIsDupKey && iAttempt === 0) {
                                sCrId = await generateNextCrId(cds.db);
                                continue;
                            }
                            throw eInsert;
                        }
                    }
                } else {
                    // ── Verify existing CR can still be edited ────────────
                    const [existing] = await SELECT.from('mdm.portal.CRHeader')
                        .where({ cr_id: sCrId });
                    if (!existing) {
                        return req.error(404, `Change request ${sCrId} not found`);
                    }
                    if (existing.status !== 'DRAFT') {
                        return req.error(400, `Cannot update CR ${sCrId} — status is ${existing.status}`);
                    }

                    // ── UPDATE header ────────────────────────────────────
                    await UPDATE('mdm.portal.CRHeader').where({ cr_id: sCrId }).set({
                        bp_category_category_id        : bp_category   || null,
                        account_group_account_group_id : account_group || null,
                        reference_object_no            : reference_object_no || null,
                        business_justification         : business_justification || null,
                        priority                        : sPriority,
                        status                         : sStatus,
                        submitted_at                   : submit ? dNow : null,
                        modifiedAt                      : dNow,
                        modifiedBy                      : actor
                    });

                    // ── Delete old child rows and re-insert fresh ─────────
                    await DELETE.from('mdm.portal.CRBPRole').where({ cr_cr_id: sCrId });
                    await DELETE.from('mdm.portal.CRFieldValue').where({ cr_cr_id: sCrId });
                }

                // ── INSERT CRBPRole rows (one per resolved role) ──────────
                if (bp_roles.length) {
                    await INSERT.into('mdm.portal.CRBPRole').entries(
                        bp_roles.map(r => ({
                            cr_cr_id    : sCrId,
                            role_role_id: r.role_id,
                            instance_no : r.instance_no || 1,
                            auto_pulled : r.auto_pulled  || false
                        }))
                    );
                }

                // ── INSERT CRFieldValue rows (one per non-empty field) ────
                const aFvRows = (field_values || []).filter(fv =>
                    fv.new_value !== null &&
                    fv.new_value !== undefined &&
                    String(fv.new_value).trim() !== ''
                );

                if (aFvRows.length) {
                    await INSERT.into('mdm.portal.CRFieldValue').entries(
                        aFvRows.map(fv => ({
                            cr_cr_id        : sCrId,
                            role_id         : fv.role_id          || '',
                            instance_no     : fv.instance_no      || 1,
                            field_field_id  : fv.field_id,
                            old_value       : null,
                            new_value       : String(fv.new_value),
                            source_level    : fv.source_level     || 'ROLE',
                            prereq_indicator: fv.prereq_indicator === true
                        }))
                    );
                }

                // Notify SAP Build Process Automation on submit — same
                // helper used by submitChangeRequest. Note: unlike that
                // action, this handler never calls determineReleaseStrategy,
                // so no strategy_id exists yet at this point; BPA receives
                // null here. If Create BP's "Save & Submit" should also run
                // release-strategy determination, that's a separate change.
                if (submit) {
                    await this._triggerApprovalWorkflow(sCrId, null, actor);
                }

                // ── Audit log ─────────────────────────────────────────────
                await this.createAuditLog(
                    'CRHeader', sCrId,
                    isNew ? 'CREATE' : (submit ? 'SUBMIT' : 'UPDATE'),
                    actor
                );

                return {
                    cr_id  : sCrId,
                    status : sStatus,
                    message: submit
                        ? `Change request ${sCrId} submitted for approval.`
                        : `Change request ${sCrId} saved as draft.`
                };

            } catch (err) {
                const msg = err?.message || String(err);
                console.error('[SaveBPChangeRequest]', msg, err);
                return req.error(500, `Failed to save change request: ${msg}`);
            }
        });

        /**
         * SearchExistingBPs — lightweight search across posted CRHeaders that
         * have a reference_object_no (= posted BP number).  In a real landscape
         * this would call an SAP OData / RFC to search BP master data.
         * Here we query CRHeader rows whose status = 'POSTED' as a proxy.
         */
        this.on('SearchExistingBPs', async (req) => {
            const { query = '', country = '', category = '' } = req.data;
            const db = cds.db;

            // Pull every posted CR that has a BP number
            let rows = await db.run(
                SELECT.from('mdm.portal.CRHeader')
                    .columns('reference_object_no', 'bp_category_category_id',
                             'account_group_account_group_id', 'requester')
                    .where({ status: 'POSTED' })
                    .and('reference_object_no IS NOT NULL')
            );

            // De-duplicate by BP number (keep first occurrence)
            const seen = new Set();
            const unique = [];
            for (const r of rows) {
                const bp = r.reference_object_no;
                if (!seen.has(bp)) { seen.add(bp); unique.push(r); }
            }

            // Client-side filter (small dataset in dev/sandbox)
            const q = query.toLowerCase();
            const filtered = unique.filter(r => {
                if (q && !r.reference_object_no.toLowerCase().includes(q) &&
                    !(r.requester || '').toLowerCase().includes(q)) { return false; }
                if (country && !(r.requester || '').toLowerCase().includes(country.toLowerCase())) {
                    // country filter is best-effort without a proper BP table
                }
                if (category && r.bp_category_category_id !== category) { return false; }
                return true;
            });

            return filtered.map(r => ({
                bp_number    : r.reference_object_no,
                name         : r.requester || r.reference_object_no,
                category     : r.bp_category_category_id || '',
                account_group: r.account_group_account_group_id || '',
                country      : '',
                city         : '',
                status       : 'Active'
            }));
        });

        /**
         * GetExistingBPData — return general header data for one BP.
         * In production this calls the SAP BP OData API.  In the sandbox we
         * reconstruct it from the latest POSTED CRFieldValue rows for that BP.
         */
        this.on('GetExistingBPData', async (req) => {
            const { bp_number } = req.data;
            if (!bp_number) return req.error(400, 'bp_number is required');
            const db = cds.db;

            // Find the CR that posted this BP number
            const cr = await db.run(
                SELECT.one.from('mdm.portal.CRHeader')
                    .where({ reference_object_no: bp_number, status: 'POSTED' })
            );

            if (!cr) {
                // Return a minimal stub so the UI can still work
                return {
                    bp_number,
                    name         : bp_number,
                    name2        : '',
                    category     : '',
                    account_group: '',
                    country      : '',
                    city         : '',
                    street       : '',
                    telephone    : '',
                    email        : '',
                    existing_roles: []
                };
            }

            // Read field values from the posting CR
            const fvRows = await db.run(
                SELECT.from('mdm.portal.CRFieldValue')
                    .where({ cr_id: cr.cr_id })
            );
            const fv = {};
            fvRows.forEach(r => { fv[r.field_field_id] = r.new_value || ''; });

            // Read which roles that CR covered
            const roleRows = await db.run(
                SELECT.from('mdm.portal.CRBPRole')
                    .columns('role_role_id')
                    .where({ cr_id: cr.cr_id })
            );

            return {
                bp_number,
                name         : fv['NAME1'] || bp_number,
                name2        : fv['NAME2'] || '',
                category     : cr.bp_category_category_id || '',
                account_group: cr.account_group_account_group_id || '',
                country      : fv['COUNTRY'] || '',
                city         : fv['CITY'] || '',
                street       : fv['STREET'] || '',
                telephone    : fv['TELEPHONE'] || '',
                email        : fv['EMAIL'] || '',
                existing_roles: roleRows.map(r => r.role_role_id)
            };
        });

        /**
         * GetBPRoleInstances — returns each saved prerequisite-field combination
         * for a given BP number + role.  In production this reads from the SAP
         * company-code / sales-area extension tables.  In the sandbox we read the
         * CRFieldValue rows grouped by instance_no for matching POSTED CRs.
         */
        this.on('GetBPRoleInstances', async (req) => {
            const { bp_number, role_id } = req.data;
            if (!bp_number || !role_id) return req.error(400, 'bp_number and role_id are required');
            const db = cds.db;

            // Find all POSTED CRs that covered this BP number and this role
            const crRows = await db.run(
                SELECT.from('mdm.portal.CRHeader')
                    .where({ reference_object_no: bp_number, status: 'POSTED' })
            );
            if (!crRows.length) return [];

            const crIds = crRows.map(r => r.cr_id);

            // Verify those CRs actually included this role
            const roleMatches = await db.run(
                SELECT.from('mdm.portal.CRBPRole')
                    .where({ role_role_id: role_id })
                    .and({ cr_id: { in: crIds } })
            );
            const matchedCrIds = roleMatches.map(r => r.cr_id);
            if (!matchedCrIds.length) return [];

            // Fetch prereq field definitions for this role (to know the key fields)
            const prereqDefs = await db.run(
                SELECT.from('mdm.portal.BPRolePrereqField')
                    .columns('field_field_id', 'sequence')
                    .where({ role_role_id: role_id })
                    .orderBy('sequence')
            );
            const prereqFieldIds = prereqDefs.map(p => p.field_field_id);

            // Fetch all field values for these CRs, grouped by (cr_id, instance_no)
            const fvRows = await db.run(
                SELECT.from('mdm.portal.CRFieldValue')
                    .where({ cr_id: { in: matchedCrIds } })
                    .and({ role_id })
                    .orderBy('cr_id', 'instance_no', 'field_field_id')
            );

            // Build one instance per unique (cr_id, instance_no) combination
            const instanceMap = new Map();
            fvRows.forEach(fv => {
                const key = `${fv.cr_id}::${fv.instance_no}`;
                if (!instanceMap.has(key)) {
                    instanceMap.set(key, { cr_id: fv.cr_id, instance_no: fv.instance_no, fields: {} });
                }
                instanceMap.get(key).fields[fv.field_field_id] = fv.new_value || '';
            });

            const instances = Array.from(instanceMap.values());
            let instanceNo = 1;

            return instances.map(inst => {
                const keyObj = {};
                prereqFieldIds.forEach(fid => { keyObj[fid] = inst.fields[fid] || ''; });
                const keyLabel = prereqFieldIds.map(fid => inst.fields[fid] || '—').join(' / ');
                return {
                    instance_no : instanceNo++,
                    key_label   : keyLabel,
                    key_values  : JSON.stringify(keyObj),
                    field_values: JSON.stringify(inst.fields)
                };
            });
        });

        await super.init();
    }
}

module.exports = MDMPortalService;