sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "mdm/portal/util/ApprovalHelper"
], function (Controller, JSONModel, ApprovalHelper) {
    "use strict";

    return Controller.extend("mdm.portal.controller.MyApprovals", {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy         : false,
                rows         : [],
                statPending  : 0,
                statOverdue  : 0,
                statDueToday : 0,
                statCompleted: 0,
                noDataText   : "No pending approvals \u2014 you're all caught up."
            });
            this.getView().setModel(this._oViewModel, "view");

            // Full unfiltered row set (kept separately so stat-chip / search /
            // type filters can all be re-applied client-side without refetching)
            this._aAllRows = [];
            this._sStatFilter = "pending";

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("myApprovals").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadApprovals();
        },

        onRefresh: function () {
            this._loadApprovals();
        },

        // ── Load data ────────────────────────────────────────────────

        _loadApprovals: function () {
            var oVm = this._oViewModel;
            var oModel = this.getOwnerComponent().getModel();
            var that = this;

            oVm.setProperty("/busy", true);

            ApprovalHelper.getCurrentUserId(oModel)
                .then(function (sUserId) {
                    that._sUserId = sUserId;
                    return ApprovalHelper.getMyPendingApprovals(oModel, sUserId);
                })
                .then(function (aRows) {
                    return that._enrichWithReleaseCodeDescriptions(oModel, aRows);
                })
                .then(function (aRows) {
                    return that._loadCompletedCount(oModel).then(function (iCompleted) {
                        return { rows: aRows, completed: iCompleted };
                    });
                })
                .then(function (oResult) {
                    var oNow = new Date();
                    var sTodayKey = oNow.toDateString();

                    oResult.rows.forEach(function (r) {
                        var oDue = r.due_at ? new Date(r.due_at) : null;
                        r.isOverdue = !!(oDue && oDue < oNow);
                        r.isDueToday = !!(oDue && !r.isOverdue && oDue.toDateString() === sTodayKey);
                    });

                    that._aAllRows = oResult.rows;

                    oVm.setProperty("/statPending",   oResult.rows.length);
                    oVm.setProperty("/statOverdue",   oResult.rows.filter(function (r) { return r.isOverdue; }).length);
                    oVm.setProperty("/statDueToday",  oResult.rows.filter(function (r) { return r.isDueToday; }).length);
                    oVm.setProperty("/statCompleted", oResult.completed);

                    that._applyFilters();
                    oVm.setProperty("/busy", false);
                })
                .catch(function (oErr) {
                    oVm.setProperty("/busy", false);
                    console.error("Could not load approvals inbox:", oErr);
                });
        },

        // Enriches each row's release_code_id with its description for the
        // "My Code" column (e.g. "02" \u2192 "02 \u2014 Sales Manager").
        _enrichWithReleaseCodeDescriptions: function (oModel, aRows) {
            if (!aRows.length) { return Promise.resolve(aRows); }
            var sBase = oModel.getServiceUrl().replace(/\/$/, "");

            return fetch(sBase + "/ReleaseCodes?$select=release_code_id,description&$top=200",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    var mDesc = {};
                    ((d && d.value) || []).forEach(function (c) {
                        mDesc[c.release_code_id] = c.description;
                    });
                    aRows.forEach(function (r) {
                        var sDesc = mDesc[r.release_code_id];
                        r.release_code_id = r.release_code_id + (sDesc ? " \u2014 " + sDesc : "");
                    });
                    return aRows;
                })
                .catch(function () { return aRows; });
        },

        // Count of decisions THIS user made in the last 30 days, for the
        // "Completed (30d)" stat chip.
        _loadCompletedCount: function (oModel) {
            if (!this._sUserId) { return Promise.resolve(0); }
            var sBase = oModel.getServiceUrl().replace(/\/$/, "");
            var oSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            var sSince = oSince.toISOString();

            return fetch(sBase + "/CRApprovalDecisions?$filter=acted_by eq '" +
                encodeURIComponent(this._sUserId) + "' and acted_at ge " + sSince +
                "&$count=true&$top=1",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) { return (d && d["@odata.count"]) || 0; })
                .catch(function () { return 0; });
        },

        // ── Filters ──────────────────────────────────────────────────

        onStatFilterChange: function (oEvent) {
            this._sStatFilter = oEvent.getParameter("key");
            this._applyFilters();
        },

        onFilterChange: function () {
            this._applyFilters();
        },

        onSearch: function () {
            this._applyFilters();
        },

        _applyFilters: function () {
            var oVm = this._oViewModel;
            var sType = this.byId("selApType") ? this.byId("selApType").getSelectedKey() : "";
            var sQuery = this.byId("apSearch") ? this.byId("apSearch").getValue().toLowerCase() : "";

            var aRows = this._aAllRows;

            if (this._sStatFilter === "overdue") {
                aRows = aRows.filter(function (r) { return r.isOverdue; });
            } else if (this._sStatFilter === "dueToday") {
                aRows = aRows.filter(function (r) { return r.isDueToday; });
            } else if (this._sStatFilter === "completed") {
                // Completed decisions have a different shape (they're no
                // longer "pending steps") — see each request's own History
                // tab in Approval Detail for the full decision trail.
                aRows = [];
                oVm.setProperty("/noDataText",
                    "Completed approvals aren't listed here \u2014 open a request and check its History tab for your past decisions.");
            } else {
                oVm.setProperty("/noDataText", "No pending approvals \u2014 you're all caught up.");
            }

            if (sType) {
                aRows = aRows.filter(function (r) { return r.request_type === sType; });
            }
            if (sQuery) {
                aRows = aRows.filter(function (r) {
                    return (r.cr_id || "").toLowerCase().indexOf(sQuery) >= 0 ||
                        (r.subject || "").toLowerCase().indexOf(sQuery) >= 0 ||
                        (r.requester || "").toLowerCase().indexOf(sQuery) >= 0;
                });
            }

            oVm.setProperty("/rows", aRows);
        },

        // ── Navigation ───────────────────────────────────────────────

        onRowPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("view");
            if (!oCtx) { return; }
            var oRow = oCtx.getObject();
            this.getOwnerComponent().getRouter().navTo("approvalDetail", {
                crId: encodeURIComponent(oRow.cr_id),
                stepNumber: oRow.step_number
            });
        },

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("home", {}, true);
        }
    });
});