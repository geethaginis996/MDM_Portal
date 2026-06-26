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
        //  AUDIT HOOKS — FieldMaster, FieldGroup, BPCategory, BPRole
        //  Writes a row to AuditLog on every CREATE, UPDATE, DELETE so that
        //  the Change Log tab on each detail screen shows a full history.
        // =====================================================================

        const AUDIT_ENTITIES = [
            { entity: 'FieldMasters',  name: 'FieldMaster',  key: 'field_id'         },
            { entity: 'FieldGroups',   name: 'FieldGroup',   key: 'group_id'         },
            { entity: 'BPCategories',  name: 'BPCategory',   key: 'category_id'      },
            { entity: 'BPRoles',       name: 'BPRole',       key: 'role_id'          },
        ];

        for (const cfg of AUDIT_ENTITIES) {
            // AFTER CREATE
            this.after('CREATE', cfg.entity, async (data, req) => {
                const sKey = data[cfg.key] || '';
                await this.createAuditLog(
                    cfg.name, sKey, 'CREATE',
                    req.user?.id || 'system',
                    null, data
                );
            });

            // BEFORE UPDATE — read current values for the before snapshot
            this.before('UPDATE', cfg.entity, async (req) => {
                const db = cds.db;
                const sKey = req.data[cfg.key] || req.params?.[0];
                if (!sKey) return;
                const before = await db.read(`mdm.portal.${cfg.name}`).where({ [cfg.key]: sKey });
                req._auditBefore = before?.[0] || null;
            });

            // AFTER UPDATE
            this.after('UPDATE', cfg.entity, async (data, req) => {
                const sKey = data?.[cfg.key] || req.data?.[cfg.key] || req.params?.[0];
                if (!sKey) return;
                await this.createAuditLog(
                    cfg.name, sKey, 'UPDATE',
                    req.user?.id || 'system',
                    req._auditBefore || null,
                    data || req.data
                );
            });

            // AFTER DELETE
            this.after('DELETE', cfg.entity, async (data, req) => {
                const sKey = req.data?.[cfg.key] || req.params?.[0];
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
                submit,
                bp_roles     = [],
                field_values = []
            } = req.data;

            const actor   = req.user?.id || 'system';
            const isNew   = !existingCrId;
            const sCrId   = isNew
                ? `CR-${new Date().getFullYear()}-${uuid().slice(0,6).toUpperCase()}`
                : existingCrId;
            const sStatus = submit ? 'IN_APPROVAL' : 'DRAFT';

            try {
                if (isNew) {
                    // ── INSERT new CRHeader ──────────────────────────────
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
                        priority                          : 'NORMAL',
                        business_justification            : business_justification || null,
                        status                            : sStatus,
                        submitted_at                      : submit ? new Date() : null
                    });
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
                        status                         : sStatus,
                        submitted_at                   : submit ? new Date() : null
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
