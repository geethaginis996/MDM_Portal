sap.ui.define([], function () {
    "use strict";

    /**
     * Shared "what is actionable by me, right now" logic for the approval
     * workflow. Used by BOTH App.controller.js (ShellBar notification badge
     * count) and MyApprovals.controller.js (the inbox table) so the two
     * never disagree about what counts as a pending approval — mirrors the
     * "shared core" philosophy already used server-side by
     * _applyStepDecision (shared between approveReleaseStep and
     * recordApprovalDecision).
     *
     * IMPORTANT — why this can't just filter CRReleaseStep by status='PENDING':
     * createReleaseStrategySnapshot() inserts ALL of a CR's steps as PENDING
     * up front, not just the current stage's. So a step being PENDING does
     * NOT mean it's actionable yet — a later-stage approver's step is also
     * PENDING while an earlier stage is still being worked. This helper
     * groups each CR's steps by step_number (ascending) and only treats the
     * lowest step_number that isn't fully APPROVED as "current" — mirroring
     * the grouping srv/mdm-service.js's _computeApprovalStages intends,
     * without depending on CRReleaseStep.parallel (which the runtime
     * snapshot never actually populates — see createReleaseStrategySnapshot,
     * so today every step_number is effectively its own stage; this helper
     * stays correct even if that gets fixed later, since parallel siblings
     * would simply share a step_number).
     */

    function _fetchJson(sUrl) {
        return fetch(sUrl, { headers: { Accept: "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (d) { return (d && d.value !== undefined) ? d.value : d; })
            .catch(function () { return []; });
    }

    // Groups steps (already filtered to one CR) by step_number and returns
    // the lowest step_number group that is not yet fully APPROVED.
    function _currentStageSteps(aStepsForOneCr) {
        var mByStep = {};
        var aStepNumbers = [];
        aStepsForOneCr.forEach(function (s) {
            if (!mByStep[s.step_number]) {
                mByStep[s.step_number] = [];
                aStepNumbers.push(s.step_number);
            }
            mByStep[s.step_number].push(s);
        });
        aStepNumbers.sort(function (a, b) { return a - b; });

        for (var i = 0; i < aStepNumbers.length; i++) {
            var aGroup = mByStep[aStepNumbers[i]];
            var bFullyApproved = aGroup.every(function (s) { return s.status === "APPROVED"; });
            if (!bFullyApproved) { return aGroup; }
        }
        return [];
    }

    return {

        /**
         * Groups steps (already filtered to ONE cr_id) by step_number and
         * returns the lowest step_number group that isn't yet fully
         * APPROVED — i.e. the currently actionable stage. Returns [] if
         * every step is already APPROVED (CR fully released).
         */
        currentStageSteps: _currentStageSteps,

        /** Resolves the logged-in user's ID via the getCurrentUser function. */
        getCurrentUserId: function (oModel) {
            var sBase = oModel.getServiceUrl().replace(/\/$/, "");
            return fetch(sBase + "/getCurrentUser()", { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) { return (d && d.user_id) || "anonymous"; })
                .catch(function () { return "anonymous"; });
        },

        /**
         * Resolves the full list of steps currently actionable by the given
         * user across every IN_APPROVAL change request — i.e. what the My
         * Approvals inbox should show, and what the ShellBar badge should
         * count.
         *
         * @returns {Promise<Array>} rows: { cr_id, request_type, subject,
         *   master_data_type_id, requester, submitted_at, strategy_id,
         *   step_number, release_code_id, release_code_desc, due_at }
         */
        getMyPendingApprovals: function (oModel, sUserId) {
            var sBase = oModel.getServiceUrl().replace(/\/$/, "");

            var pCrs = _fetchJson(
                sBase + "/ChangeRequests?$filter=status eq 'IN_APPROVAL'" +
                "&$select=cr_id,request_type,master_data_type_master_data_type_id," +
                "bp_category_category_id,account_group_account_group_id," +
                "reference_object_no,requester,submitted_at," +
                "strategy_strategy_id&$top=500"
            );

            var pMyCodes = _fetchJson(
                sBase + "/ReleaseCodeUsers?$filter=user_id eq '" + encodeURIComponent(sUserId) +
                "' and active eq true&$select=release_code_release_code_id&$top=200"
            );

            return Promise.all([pCrs, pMyCodes]).then(function (aResults) {
                var aCrs     = aResults[0] || [];
                var aMyCodes = (aResults[1] || []).map(function (c) { return c.release_code_release_code_id; });

                if (!aCrs.length) { return []; }

                var mCrById = {};
                var aFilterParts = [];
                aCrs.forEach(function (cr) {
                    mCrById[cr.cr_id] = cr;
                    aFilterParts.push("cr_cr_cr_id eq '" + encodeURIComponent(cr.cr_id) + "'");
                });

                // Batch the OR filter in chunks of 40 CRs to keep the query
                // string a sane length (same defensive chunking spirit as
                // the role-filter batching in MyRequestDetail.controller.js).
                var aChunks = [];
                for (var i = 0; i < aFilterParts.length; i += 40) {
                    aChunks.push(aFilterParts.slice(i, i + 40));
                }

                var aStepPromises = aChunks.map(function (aChunk) {
                    return _fetchJson(
                        sBase + "/CRReleaseSteps?$filter=(" + aChunk.join(" or ") + ")" +
                        "&$select=cr_cr_cr_id,step_number,sequence_within_step," +
                        "release_code_release_code_id,assigned_to,status,due_at&$top=5000"
                    );
                });

                return Promise.all(aStepPromises).then(function (aChunkResults) {
                    var aAllSteps = [].concat.apply([], aChunkResults);

                    // Group by CR
                    var mStepsByCr = {};
                    aAllSteps.forEach(function (s) {
                        if (!mStepsByCr[s.cr_cr_cr_id]) { mStepsByCr[s.cr_cr_cr_id] = []; }
                        mStepsByCr[s.cr_cr_cr_id].push(s);
                    });

                    var aRows = [];
                    Object.keys(mStepsByCr).forEach(function (sCrId) {
                        var aCurrentStage = _currentStageSteps(mStepsByCr[sCrId]);
                        aCurrentStage.forEach(function (step) {
                            var bMine = step.status === "PENDING" && (
                                (step.assigned_to && step.assigned_to === sUserId) ||
                                aMyCodes.indexOf(step.release_code_release_code_id) >= 0
                            );
                            if (!bMine) { return; }

                            var cr = mCrById[sCrId] || {};
                            var sSubject = (cr.bp_category_category_id || cr.account_group_account_group_id ||
                                cr.master_data_type_master_data_type_id || "") +
                                (cr.reference_object_no ? " \u2014 " + cr.reference_object_no : "");

                            aRows.push({
                                cr_id             : sCrId,
                                request_type      : cr.request_type || "",
                                subject           : sSubject,
                                master_data_type_id: cr.master_data_type_master_data_type_id || "",
                                requester         : cr.requester || "",
                                submitted_at      : cr.submitted_at || null,
                                strategy_id       : cr.strategy_strategy_id || "",
                                step_number       : step.step_number,
                                release_code_id   : step.release_code_release_code_id,
                                due_at            : step.due_at || null
                            });
                        });
                    });

                    return aRows;
                });
            });
        }
    };
});
