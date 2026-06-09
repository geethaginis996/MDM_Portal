// =============================================================================
//  SAP MDM Portal — Service Implementation
// =============================================================================

const cds = require('@sap/cds');
const { v4: uuid } = require('uuid');

class MDMPortalService extends cds.ApplicationService {
    async init() {

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
        this.on('submitChangeRequest', async (req) => {
            const { cr_id } = req.data;
            const db = cds.db;

            try {
                // Fetch CR
                const cr = await db.read('mdm.portal.CRHeader', cr_id);
                if (!cr) {
                    return req.error(404, `Change Request ${cr_id} not found`);
                }

                if (cr.status !== 'DRAFT') {
                    return req.error(400, `Cannot submit CR in ${cr.status} status`);
                }

                // Validate required fields
                if (!cr.scenario_code || !cr.master_data_type_id) {
                    return req.error(400, 'Scenario Code and Master Data Type are required');
                }

                // Fetch field values to determine strategy
                const fieldValues = await db.read('mdm.portal.CRFieldValue', (q) =>
                    q.where({ cr_id })
                );

                // Call function to determine strategy
                const strategyResult = await this.determineReleaseStrategy(
                    cr.master_data_type_id,
                    cr.scenario_code,
                    fieldValues.map((fv) => ({
                        characteristic_id: fv.field_id,
                        value: fv.new_value,
                    }))
                );

                if (!strategyResult || !strategyResult.strategy_id) {
                    return req.error(400, 'No matching release strategy found');
                }

                // Update CR status
                await db.update('mdm.portal.CRHeader', cr_id).set({
                    status: 'IN_APPROVAL',
                    submitted_at: new Date(),
                    strategy_id: strategyResult.strategy_id,
                });

                // Create release strategy snapshot
                await this.createReleaseStrategySnapshot(
                    cr_id,
                    strategyResult.strategy_id
                );

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
                // Fetch CR Release Strategy
                const crReleaseStrat = await db.read(
                    'mdm.portal.CRReleaseStrategy',
                    cr_id
                );

                if (!crReleaseStrat) {
                    return req.error(404, `No release strategy for CR ${cr_id}`);
                }

                // Fetch the step
                const step = await db.read('mdm.portal.CRReleaseStep', (q) =>
                    q.where({ cr_id, step_number })
                );

                if (!step) {
                    return req.error(404, `Step ${step_number} not found`);
                }

                const validActions = ['APPROVE', 'REJECT', 'SEND_BACK'];
                if (!validActions.includes(action)) {
                    return req.error(400, `Invalid action: ${action}`);
                }

                // Update step
                await db.update('mdm.portal.CRReleaseStep').set({
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
                            cr_id,
                            step_number,
                            sequence_within_step: 1,
                            release_code_id: step.release_code_id,
                            action,
                            acted_by: req.user.id,
                            acted_at: new Date(),
                            comment,
                        },
                    ])
                );

                // Update CR status based on action
                if (action === 'REJECT') {
                    await db.update('mdm.portal.CRHeader', cr_id).set({
                        status: 'REJECTED',
                    });
                } else if (action === 'SEND_BACK') {
                    await db.update('mdm.portal.CRHeader', cr_id).set({
                        status: 'SENT_BACK',
                    });
                } else if (action === 'APPROVE') {
                    // Check if all steps are approved
                    const remainingSteps = await db.read(
                        'mdm.portal.CRReleaseStep',
                        (q) =>
                            q.where({
                                cr_id,
                                status: { '!=': 'APPROVED' },
                            })
                    );

                    if (remainingSteps.length === 0) {
                        await db.update('mdm.portal.CRHeader', cr_id).set({
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
                const cr = await db.read('mdm.portal.CRHeader', cr_id);

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

                // Update CR
                await db.update('mdm.portal.CRHeader', cr_id).set({
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
                    .update('mdm.portal.CRHeader', cr_id)
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
            data.cr_id = data.cr_id || `CR-${new Date().getFullYear()}-${uuid().slice(0, 6).toUpperCase()}`;
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
            // TODO: Implement logic to find matching strategy
            // based on master data type, scenario, and field values
            return {
                strategy_id: 'STRAT-001',
                steps_count: 2,
                estimated_duration_hours: 24,
            };
        };

        this.createReleaseStrategySnapshot = async function (crId, strategyId) {
            const db = cds.db;
            const strategy = await db.read('mdm.portal.ReleaseStrategy', strategyId);

            if (!strategy) return;

            // Create CRReleaseStrategy record
            await db.run(
                INSERT.into('mdm.portal.CRReleaseStrategy').entries([
                    {
                        cr_id: crId,
                        strategy_id: strategyId,
                        determined_at: new Date(),
                        overall_status: 'IN_PROGRESS',
                        current_step: 1,
                    },
                ])
            );

            // Create steps
            const steps = await db.read('mdm.portal.ReleaseStrategyStep', (q) =>
                q.where({ strategy_id: strategyId })
            );

            for (const step of steps) {
                await db.run(
                    INSERT.into('mdm.portal.CRReleaseStep').entries([
                        {
                            cr_id: crId,
                            step_number: step.step_number,
                            sequence_within_step: 1,
                            release_code_id: step.release_code_id,
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

        this.createAuditLog = async function (
            entityName,
            entityKey,
            action,
            actor
        ) {
            const db = cds.db;
            await db.run(
                INSERT.into('mdm.portal.AuditLog').entries([
                    {
                        audit_id: uuid(),
                        entity_name: entityName,
                        entity_key: entityKey,
                        action,
                        actor,
                        acted_at: new Date(),
                    },
                ])
            );
        };

        await super.init();
    }
}

module.exports = MDMPortalService;
