sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessageStrip",
    "sap/m/IconTabFilter",
    "sap/m/Panel",
    "sap/m/Title",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/ObjectStatus",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/ObjectIdentifier",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Dialog",
    "sap/m/TextArea",
    "sap/m/Button",
    "sap/ui/core/Icon",
    "mdm/portal/util/ApprovalHelper"
], function (
    Controller, JSONModel, MessageBox, MessageToast, MessageStrip,
    IconTabFilter, Panel, Title, Label, Text, ObjectStatus,
    Table, Column, ColumnListItem, ObjectIdentifier,
    VBox, HBox, Dialog, TextArea, Button, Icon,
    ApprovalHelper
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ApprovalDetail", {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy              : false,
                crId              : "",
                subtitle          : "",
                status            : "",
                actionable        : false,
                scopeTitle        : "",
                scopeSubtitle     : "",
                infoBannerText    : "",
                infoBannerVisible : false
            });
            this.getView().setModel(this._oViewModel, "view");

            this._mFieldMeta = {};
            this._mGroupMeta = {};
            this._mRoleMeta  = {};
            this._mReleaseCodeMeta = {};

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("approvalDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            this._sCrId = decodeURIComponent(oArgs.crId);
            this._iStepNumber = parseInt(oArgs.stepNumber, 10);
            this._loadAll();
        },

        // ── Load everything ──────────────────────────────────────────

        _loadAll: function () {
            var oVm    = this._oViewModel;
            var oModel = this.getOwnerComponent().getModel();
            var sBase  = oModel.getServiceUrl().replace(/\/$/, "");
            var sCrKey = "'" + encodeURIComponent(this._sCrId) + "'";
            var that   = this;

            oVm.setProperty("/busy", true);
            oVm.setProperty("/crId", this._sCrId);
            var oTabs = this.byId("approvalTabs");
            if (oTabs) { oTabs.destroyItems(); }
            var oProgressBox = this.byId("releaseProgressBox");
            if (oProgressBox) { oProgressBox.destroyItems(); }

            function fetchJson(sUrl) {
                return fetch(sUrl, { headers: { Accept: "application/json" } })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { return (d && d.value !== undefined) ? d.value : d; })
                    .catch(function () { return []; });
            }

            ApprovalHelper.getCurrentUserId(oModel).then(function (sUserId) {
                that._sUserId = sUserId;

                var pHeader = fetchJson(sBase + "/ChangeRequests(" + sCrKey + ")");

                var pSteps = fetchJson(
                    sBase + "/CRReleaseSteps?$filter=cr_cr_cr_id eq " + sCrKey +
                    "&$select=cr_cr_cr_id,step_number,sequence_within_step," +
                    "release_code_release_code_id,assigned_to,status,due_at,acted_by,acted_at,comment" +
                    "&$orderby=step_number,sequence_within_step&$top=200"
                );

                var pReleaseCodes = fetchJson(
                    sBase + "/ReleaseCodes?$select=release_code_id,description,sla_hours&$top=200"
                );

                var pRoles = fetchJson(
                    sBase + "/CRBPRoles?$filter=cr_cr_id eq " + sCrKey +
                    "&$select=cr_cr_id,role_role_id,instance_no,auto_pulled&$top=100"
                );

                var pFvs = fetchJson(
                    sBase + "/CRFieldValues?$filter=cr_cr_id eq " + sCrKey +
                    "&$select=cr_cr_id,role_id,instance_no,field_field_id,old_value,new_value,source_level&$top=5000"
                );

                var pAtts = fetchJson(
                    sBase + "/CRAttachments?$filter=cr_cr_id eq " + sCrKey +
                    "&$select=attachment_id,file_name,size_bytes,mime_type,description,uploaded_by,uploaded_at&$top=200"
                );

                var pDecisions = fetchJson(
                    sBase + "/CRApprovalDecisions?$filter=cr_cr_id eq " + sCrKey +
                    "&$orderby=acted_at&$top=500"
                );

                var pRoleMeta  = fetchJson(sBase + "/BPRoles?$select=role_id,description&$top=500");
                var pFieldMeta = fetchJson(sBase + "/FieldMasters?$select=field_id,description,main_group_group_id,sub_group_group_id&$top=2000");
                var pGroupMeta = fetchJson(sBase + "/FieldGroups?$select=group_id,description,parent_group_id_group_id,sequence,icon&$top=500");

                var pMyCodes = fetchJson(
                    sBase + "/ReleaseCodeUsers?$filter=user_id eq '" + encodeURIComponent(sUserId) +
                    "' and active eq true&$select=release_code_release_code_id&$top=200"
                );

                return Promise.all([
                    pHeader, pSteps, pReleaseCodes, pRoles, pFvs, pAtts,
                    pDecisions, pRoleMeta, pFieldMeta, pGroupMeta, pMyCodes
                ]);
            }).then(function (aRes) {
                var oCr          = aRes[0];
                var aSteps       = aRes[1] || [];
                var aReleaseCodes = aRes[2] || [];
                var aRolesRaw    = aRes[3] || [];
                var aFvsRaw      = aRes[4] || [];
                var aAttsRaw     = aRes[5] || [];
                var aDecisionsRaw = aRes[6] || [];
                var aRoleMetaRaw = aRes[7] || [];
                var aFieldMetaRaw = aRes[8] || [];
                var aGroupMetaRaw = aRes[9] || [];
                var aMyCodesRaw  = aRes[10] || [];

                that._oCr = oCr || {};
                that._aAllSteps = aSteps;

                that._mReleaseCodeMeta = {};
                aReleaseCodes.forEach(function (c) {
                    that._mReleaseCodeMeta[c.release_code_id] = {
                        description: c.description || "",
                        sla_hours  : c.sla_hours
                    };
                });

                var aRoleIds = [];
                aRolesRaw.forEach(function (r) {
                    var sId = r.role_role_id || r.role_id;
                    if (sId && aRoleIds.indexOf(sId) < 0) { aRoleIds.push(sId); }
                });
                that._aCrRoleIds = aRoleIds;

                that._aCrFieldValues = aFvsRaw.map(function (fv) {
                    return {
                        role_id  : fv.role_id || "",
                        field_id : fv.field_field_id || fv.field_id || "",
                        old_value: fv.old_value || "",
                        new_value: fv.new_value || "",
                        source_level: fv.source_level || ""
                    };
                });

                that._aAttachments = aAttsRaw.map(function (a) {
                    return {
                        file_name  : a.file_name  || "",
                        size_bytes : a.size_bytes || 0,
                        mime_type  : a.mime_type  || "",
                        uploaded_by: a.uploaded_by || "",
                        uploaded_at: a.uploaded_at
                            ? new Date(a.uploaded_at).toLocaleString() : ""
                    };
                });

                that._aDecisions = aDecisionsRaw.map(function (d) {
                    return {
                        action    : d.action || "",
                        acted_by  : d.acted_by || "",
                        acted_at  : d.acted_at || null,
                        comment   : d.comment || "",
                        release_code_id: d.release_code_release_code_id || ""
                    };
                });

                that._mRoleMeta = {};
                aRoleMetaRaw.forEach(function (r) { that._mRoleMeta[r.role_id] = r.description || ""; });

                that._mFieldMeta = {};
                aFieldMetaRaw.forEach(function (f) {
                    that._mFieldMeta[f.field_id] = {
                        description: f.description || "",
                        mainGroup  : f.main_group_group_id || "GD",
                        subGroup   : f.sub_group_group_id  || ""
                    };
                });

                that._mGroupMeta = {};
                aGroupMetaRaw.forEach(function (g) {
                    that._mGroupMeta[g.group_id] = {
                        description: g.description || g.group_id,
                        parentId   : g.parent_group_id_group_id || null,
                        sequence   : g.sequence || 99,
                        icon       : g.icon || "sap-icon://form"
                    };
                });

                var aMyCodes = aMyCodesRaw.map(function (c) { return c.release_code_release_code_id; });
                that._aMyCodes = aMyCodes;

                // ── Determine current stage + "my" step ─────────────────
                var aCurrentStage = ApprovalHelper.currentStageSteps(aSteps);
                that._iCurrentStageNumber = aCurrentStage.length ? aCurrentStage[0].step_number : null;

                var aStepsAtRoute = aSteps.filter(function (s) { return s.step_number === that._iStepNumber; });
                var oIdentityStep = aStepsAtRoute.filter(function (s) {
                    return (s.assigned_to && s.assigned_to === that._sUserId) ||
                        aMyCodes.indexOf(s.release_code_release_code_id) >= 0;
                })[0];

                that._myStep = oIdentityStep || aStepsAtRoute[0] || null;
                that._sMyReleaseCode = that._myStep ? that._myStep.release_code_release_code_id : null;

                var bIsCurrentStage  = that._iCurrentStageNumber !== null && that._iCurrentStageNumber === that._iStepNumber;
                var bIdentityMatch   = !!oIdentityStep;
                var bPending         = !!(that._myStep && that._myStep.status === "PENDING");
                var bHeaderInApproval = that._oCr.status === "IN_APPROVAL";

                var bActionable = bIdentityMatch && bPending && bIsCurrentStage && bHeaderInApproval;
                oVm.setProperty("/actionable", bActionable);

                var sBanner = "";
                if (!that._myStep) {
                    sBanner = "This step could not be found on the current release strategy snapshot.";
                } else if (!bHeaderInApproval) {
                    sBanner = "This request is " + (that._oCr.status || "").replace(/_/g, " ") + " \u2014 no further action is needed.";
                } else if (!bIsCurrentStage) {
                    sBanner = "This step isn't the active stage right now \u2014 it may already have been actioned, or an earlier stage is still pending.";
                } else if (!bIdentityMatch) {
                    sBanner = "You aren't an assigned approver for this step \u2014 showing read-only.";
                } else if (!bPending) {
                    sBanner = "This step has already been " + (that._myStep.status || "").toLowerCase().replace(/_/g, " ") + ".";
                }
                oVm.setProperty("/infoBannerText", sBanner);
                oVm.setProperty("/infoBannerVisible", !!sBanner);

                oVm.setProperty("/status", that._oCr.status || "");
                var sSubtitle = "Submitted by " + (that._oCr.requester || "\u2014") +
                    (that._oCr.submitted_at ? " on " + new Date(that._oCr.submitted_at).toLocaleDateString() : "") +
                    (that._oCr.strategy_strategy_id ? " \u00b7 Strategy " + that._oCr.strategy_strategy_id : "");
                oVm.setProperty("/subtitle", sSubtitle);

                // Scope rows need the codes actually used on this CR
                var aCodesUsed = [];
                aSteps.forEach(function (s) {
                    if (s.release_code_release_code_id && aCodesUsed.indexOf(s.release_code_release_code_id) < 0) {
                        aCodesUsed.push(s.release_code_release_code_id);
                    }
                });

                return that._loadScopes(sBase, fetchJson, aCodesUsed);
            }).then(function () {
                that._renderAll();
                oVm.setProperty("/busy", false);
            }).catch(function (oErr) {
                oVm.setProperty("/busy", false);
                MessageBox.error("Could not load approval: " + ((oErr && oErr.message) || String(oErr)));
            });
        },

        _loadScopes: function (sBase, fetchJson, aCodesUsed) {
            var that = this;
            if (!aCodesUsed.length) {
                this._aAllScopeRows = [];
                this._aMyScopeRows = [];
                this._bMyCodeUnrestricted = true;
                return Promise.resolve();
            }
            var sFilter = aCodesUsed.map(function (c) {
                return "release_code_release_code_id eq '" + encodeURIComponent(c) + "'";
            }).join(" or ");

            return fetchJson(
                sBase + "/ReleaseCodeScopes?$filter=" + encodeURIComponent(sFilter) +
                "&$select=release_code_release_code_id,scope_type,scope_id&$top=500"
            ).then(function (aScopes) {
                that._aAllScopeRows = aScopes || [];
                that._aMyScopeRows = that._sMyReleaseCode
                    ? that._aAllScopeRows.filter(function (s) {
                        return s.release_code_release_code_id === that._sMyReleaseCode;
                    })
                    : [];
                // A code with zero scope rows has no section-level restriction
                // configured — treat it as seeing/owning everything (mirrors
                // how Code 01 / Master Data Steward behaves in the wireframe).
                that._bMyCodeUnrestricted = that._aMyScopeRows.length === 0;
            });
        },

        // ── Render ────────────────────────────────────────────────────

        _renderAll: function () {
            this._buildReleaseProgress();
            this._buildScopeBanner();
            this._buildTabs();
        },

        _fmtDate: function (v) {
            return v ? new Date(v).toLocaleString() : "";
        },

        // ── Release Progress strip ───────────────────────────────────

        _buildReleaseProgress: function () {
            var oBox = this.byId("releaseProgressBox");
            if (!oBox) { return; }
            oBox.destroyItems();

            if (!this._aAllSteps.length) {
                oBox.addItem(new Text({ text: "No release steps found for this request.", class: "sapUiSmallMargin" }));
                return;
            }

            var that = this;
            var aStepNumbers = [];
            this._aAllSteps.forEach(function (s) {
                if (aStepNumbers.indexOf(s.step_number) < 0) { aStepNumbers.push(s.step_number); }
            });
            aStepNumbers.sort(function (a, b) { return a - b; });

            // Flatten into one ordered list first so we can tell which card
            // is truly the last one (across all step_numbers) and only skip
            // the connector arrow after that one.
            var aOrdered = [];
            aStepNumbers.forEach(function (n) {
                that._aAllSteps
                    .filter(function (s) { return s.step_number === n; })
                    .forEach(function (s) { aOrdered.push(s); });
            });

            aOrdered.forEach(function (step, idx) {
                oBox.addItem(that._buildProgressCard(step, step.step_number === that._iCurrentStageNumber));
                if (idx < aOrdered.length - 1) {
                    oBox.addItem(new Icon({
                        src: "sap-icon://arrow-right",
                        class: "sapUiTinyMarginBeginEnd sapUiTinyMarginTop",
                        color: "Default"
                    }));
                }
            });
        },

        _buildProgressCard: function (step, bIsCurrentStage) {
            var oCodeMeta = this._mReleaseCodeMeta[step.release_code_release_code_id] || {};
            var sCodeLabel = step.release_code_release_code_id +
                (oCodeMeta.description ? " \u2014 " + oCodeMeta.description : "");

            var sState, sMeta, sIcon;
            if (step.status === "APPROVED") {
                sState = "Success"; sIcon = "sap-icon://accept";
                sMeta = "Released by " + (step.acted_by || "\u2014") + " \u00b7 " + this._fmtDate(step.acted_at);
            } else if (step.status === "REJECTED") {
                sState = "Error"; sIcon = "sap-icon://decline";
                sMeta = "Rejected by " + (step.acted_by || "\u2014") + " \u00b7 " + this._fmtDate(step.acted_at);
            } else if (step.status === "SENT_BACK") {
                sState = "Warning"; sIcon = "sap-icon://redo";
                sMeta = "Sent back by " + (step.acted_by || "\u2014") + " \u00b7 " + this._fmtDate(step.acted_at);
            } else if (bIsCurrentStage) {
                var bIsMine = this._myStep && this._myStep.step_number === step.step_number &&
                    this._myStep.release_code_release_code_id === step.release_code_release_code_id;
                sState = "Warning"; sIcon = "sap-icon://pending";
                sMeta = bIsMine
                    ? "Assigned to you" + (step.due_at ? " \u00b7 Due " + this._fmtDate(step.due_at) : "")
                    : "Pending" + (step.assigned_to ? " (" + step.assigned_to + ")" : "");
            } else {
                sState = "None"; sIcon = "sap-icon://future";
                sMeta = "Pending";
            }

            return new VBox({
                width: "12rem",
                class: "sapUiSmallMarginEnd sapUiTinyMarginTop",
                items: [
                    new ObjectStatus({ icon: sIcon, state: sState, class: "sapUiTinyMarginBottom" }),
                    new Text({ text: sCodeLabel, class: "mdmScopeTitle" }),
                    new Text({ text: sMeta })
                ]
            });
        },

        // ── Scope banner ──────────────────────────────────────────────

        _buildScopeBanner: function () {
            var oVm = this._oViewModel;

            if (!this._sMyReleaseCode) {
                oVm.setProperty("/scopeTitle", "Full Request (read-only)");
                oVm.setProperty("/scopeSubtitle", "You aren't an assigned approver for the current stage of this request.");
                return;
            }

            var oCodeMeta = this._mReleaseCodeMeta[this._sMyReleaseCode] || {};
            oVm.setProperty("/scopeTitle", "Your Scope \u2014 Code " + this._sMyReleaseCode +
                (oCodeMeta.description ? " (" + oCodeMeta.description + ")" : ""));

            if (this._bMyCodeUnrestricted) {
                oVm.setProperty("/scopeSubtitle",
                    "No section-level restriction is configured for this code \u2014 you see and can review the full request.");
                return;
            }

            var that = this;
            var aRoleScopes  = this._aMyScopeRows.filter(function (s) { return s.scope_type === "BP_ROLE"; })
                .map(function (s) { return s.scope_id + (that._mRoleMeta[s.scope_id] ? " \u2014 " + that._mRoleMeta[s.scope_id] : ""); });
            var aGroupScopes = this._aMyScopeRows.filter(function (s) { return s.scope_type === "FIELD_GROUP"; })
                .map(function (s) { return (that._mGroupMeta[s.scope_id] && that._mGroupMeta[s.scope_id].description) || s.scope_id; });

            var aParts = [];
            if (aRoleScopes.length)  { aParts.push("BP role(s) " + aRoleScopes.join(", ")); }
            if (aGroupScopes.length) { aParts.push("the " + aGroupScopes.join(", ") + " section(s)"); }

            oVm.setProperty("/scopeSubtitle", aParts.length
                ? "You are responsible for releasing " + aParts.join(" and ") +
                  ". Out-of-scope sections are visible but read-only for you."
                : "No matching scope found for this code \u2014 treat other sections as informational only.");
        },

        // ── Tabs ──────────────────────────────────────────────────────

        _groupByMainTab: function (aFvs) {
            var that = this;
            var mMain = {};
            var aOrder = [];

            aFvs.forEach(function (fv) {
                var oFm = that._mFieldMeta[fv.field_id] || {};
                var sMainRef = oFm.mainGroup || "GD";
                var oMainMeta = that._mGroupMeta[sMainRef] || {};
                var sTrueTab = oMainMeta.parentId ? oMainMeta.parentId : sMainRef;
                var sSubPanel = sMainRef;

                if (!mMain[sTrueTab]) { mMain[sTrueTab] = {}; aOrder.push(sTrueTab); }
                if (!mMain[sTrueTab][sSubPanel]) { mMain[sTrueTab][sSubPanel] = []; }
                mMain[sTrueTab][sSubPanel].push(fv);
            });

            aOrder.sort(function (a, b) {
                var seqA = (that._mGroupMeta[a] && that._mGroupMeta[a].sequence) || 99;
                var seqB = (that._mGroupMeta[b] && that._mGroupMeta[b].sequence) || 99;
                return seqA - seqB;
            });

            return { mainOrder: aOrder, groups: mMain };
        },

        _isTabInScope: function (sRoleId, sMainGroupId) {
            if (this._bMyCodeUnrestricted) { return true; }
            if (!sRoleId) { return false; }
            var bRoleScoped = this._aMyScopeRows.some(function (s) {
                return s.scope_type === "BP_ROLE" && s.scope_id === sRoleId;
            });
            if (bRoleScoped) { return true; }
            if (sMainGroupId) {
                return this._aMyScopeRows.some(function (s) {
                    return s.scope_type === "FIELD_GROUP" && s.scope_id === sMainGroupId;
                });
            }
            return false;
        },

        // Finds which OTHER code (if any) claims this role/group, for the
        // "already released by Code X" out-of-scope messaging.
        _findOwningCode: function (sRoleId, sMainGroupId) {
            var oMatch = this._aAllScopeRows.find(function (s) {
                return (s.scope_type === "BP_ROLE" && s.scope_id === sRoleId) ||
                    (s.scope_type === "FIELD_GROUP" && s.scope_id === sMainGroupId);
            });
            if (!oMatch) { return null; }
            var sCode = oMatch.release_code_release_code_id;
            var oStep = this._aAllSteps.find(function (s) { return s.release_code_release_code_id === sCode; });
            return { code: sCode, description: (this._mReleaseCodeMeta[sCode] || {}).description || "", step: oStep };
        },

        _buildScopeStrip: function (sRoleId, sMainGroupId) {
            var bInScope = this._isTabInScope(sRoleId, sMainGroupId);
            if (bInScope) {
                return new MessageStrip({
                    type: "Success",
                    showIcon: true,
                    class: "sapUiSmallMarginBottom",
                    text: "In your scope \u2014 review the changes below, then use Approve, Reject, or Send Back."
                });
            }
            var oOwner = this._findOwningCode(sRoleId, sMainGroupId);
            var sText;
            if (oOwner && oOwner.step && oOwner.step.status === "APPROVED") {
                sText = "Read-only \u2014 already released by Code " + oOwner.code +
                    (oOwner.description ? " (" + oOwner.description + ")" : "") + ".";
            } else if (oOwner) {
                sText = "Read-only \u2014 owned by Code " + oOwner.code +
                    (oOwner.description ? " (" + oOwner.description + ")" : "") + ", not yet released.";
            } else {
                sText = "Read-only \u2014 outside your scope for this release code.";
            }
            return new MessageStrip({ type: "None", showIcon: true, class: "sapUiSmallMarginBottom", text: sText });
        },

        _buildDiffRow: function (fv) {
            var oFm = this._mFieldMeta[fv.field_id] || {};
            var sLabel = (oFm.description || fv.field_id) + ":";
            var bChanged = fv.old_value !== fv.new_value;

            return new HBox({
                alignItems: "Center",
                class: "sapUiTinyMarginBottom",
                items: [
                    new Label({ text: sLabel, tooltip: fv.field_id, width: "14rem", class: "sapUiTinyMarginEnd" }),
                    new Text({ text: fv.old_value || "\u2014", width: "10rem" }),
                    new Icon({ src: "sap-icon://arrow-right", class: "sapUiTinyMarginBeginEnd" }),
                    new ObjectStatus({ text: fv.new_value || "\u2014", state: bChanged ? "Success" : "None" })
                ]
            });
        },

        _buildTabsForBucket: function (sRoleId, aFvsForBucket, oTabs) {
            if (!aFvsForBucket.length) { return; }
            var that = this;
            var oGrouping = this._groupByMainTab(aFvsForBucket);

            oGrouping.mainOrder.forEach(function (sMainId) {
                var oMainMeta = that._mGroupMeta[sMainId] || {};
                var sMainLabel = oMainMeta.description || sMainId.replace(/_/g, " ");
                var sRoleDesc = sRoleId ? (that._mRoleMeta[sRoleId] || sRoleId) : "";
                var sTabLabel = sRoleId ? (sRoleId + " \u2014 " + sMainLabel) : sMainLabel;
                var sTabKey = (sRoleId || "__general") + "::" + sMainId;

                var mSubs = oGrouping.groups[sMainId];
                var iTotal = 0;
                Object.keys(mSubs).forEach(function (k) { iTotal += mSubs[k].length; });

                var oTabVBox = new VBox({ class: "sapUiSmallMarginTop" });
                oTabVBox.addItem(that._buildScopeStrip(sRoleId, sMainId));

                if (sRoleId) {
                    oTabVBox.addItem(new Text({
                        text: sRoleDesc && sRoleDesc !== sRoleId ? (sRoleId + " \u2014 " + sRoleDesc) : sRoleId,
                        class: "sapUiTinyMarginBottom mdmScopeTitle"
                    }));
                }

                var aSubKeys = Object.keys(mSubs).sort(function (a, b) {
                    var seqA = (that._mGroupMeta[a] && that._mGroupMeta[a].sequence) || 99;
                    var seqB = (that._mGroupMeta[b] && that._mGroupMeta[b].sequence) || 99;
                    return seqA - seqB;
                });

                aSubKeys.forEach(function (sSubKey) {
                    var aFvsInSub = mSubs[sSubKey];
                    var bDirect = (sSubKey === sMainId);

                    if (bDirect) {
                        var oDirectVBox = new VBox({ class: "sapUiSmallMarginBeginEnd sapUiSmallMarginTopBottom" });
                        aFvsInSub.forEach(function (fv) { oDirectVBox.addItem(that._buildDiffRow(fv)); });
                        oTabVBox.addItem(oDirectVBox);
                    } else {
                        var oSubMeta = that._mGroupMeta[sSubKey] || {};
                        var oPanel = new Panel({
                            headerText: (oSubMeta.description || sSubKey.replace(/_/g, " ")) + " (" + aFvsInSub.length + ")",
                            expandable: true,
                            expanded: true,
                            class: "sapUiSmallMarginBottom"
                        });
                        var oPanelVBox = new VBox({ class: "sapUiSmallMarginBeginEnd sapUiSmallMarginTopBottom" });
                        aFvsInSub.forEach(function (fv) { oPanelVBox.addItem(that._buildDiffRow(fv)); });
                        oPanel.addContent(oPanelVBox);
                        oTabVBox.addItem(oPanel);
                    }
                });

                oTabs.addItem(new IconTabFilter({
                    key: sTabKey,
                    text: sTabLabel,
                    icon: oMainMeta.icon || "sap-icon://form",
                    count: String(iTotal),
                    content: [oTabVBox]
                }));
            });
        },

        _buildAttachmentsTab: function () {
            var aAtts = this._aAttachments || [];
            var oVBox = new VBox({ class: "sapUiSmallMargin" });
            oVBox.addItem(new Text({ text: "Supporting documents attached to this change request.", class: "sapUiSmallMarginBottom" }));

            if (!aAtts.length) {
                oVBox.addItem(new Text({ text: "No attachments." }));
            } else {
                var oTable = new Table({
                    alternateRowColors: true,
                    columns: [
                        new Column({ header: new Label({ text: "File Name", design: "Bold" }) }),
                        new Column({ header: new Label({ text: "Size", design: "Bold" }), hAlign: "End", width: "7rem" }),
                        new Column({ header: new Label({ text: "Type", design: "Bold" }), width: "8rem" }),
                        new Column({ header: new Label({ text: "Uploaded By", design: "Bold" }), width: "9rem" }),
                        new Column({ header: new Label({ text: "Uploaded On", design: "Bold" }), width: "12rem" })
                    ]
                });
                aAtts.forEach(function (a) {
                    var sSize;
                    if (a.size_bytes < 1024) { sSize = a.size_bytes + " B"; }
                    else if (a.size_bytes < 1024 * 1024) { sSize = Math.round(a.size_bytes / 1024) + " KB"; }
                    else { sSize = (a.size_bytes / (1024 * 1024)).toFixed(1) + " MB"; }

                    oTable.addItem(new ColumnListItem({
                        cells: [
                            new ObjectIdentifier({ title: a.file_name }),
                            new Text({ text: sSize }),
                            new Text({ text: a.mime_type }),
                            new Text({ text: a.uploaded_by }),
                            new Text({ text: a.uploaded_at })
                        ]
                    }));
                });
                oVBox.addItem(oTable);
            }

            return new IconTabFilter({
                key: "__attachments", text: "Attachments", icon: "sap-icon://attachment",
                count: aAtts.length ? String(aAtts.length) : "", content: [oVBox]
            });
        },

        _buildHistoryTab: function () {
            var that = this;
            var mActionWord = {
                APPROVE: "Released", REJECT: "Rejected", SEND_BACK: "Sent back",
                REASSIGN: "Reassigned", ESCALATE: "Escalated"
            };

            var aEvents = this._aDecisions.map(function (d) {
                return {
                    ts: d.acted_at,
                    title: (mActionWord[d.action] || d.action) + (d.release_code_id ? " \u2014 Code " + d.release_code_id : ""),
                    meta: (d.acted_by || "\u2014") + " \u00b7 " + that._fmtDate(d.acted_at) +
                        (d.comment ? " \u00b7 \u201c" + d.comment + "\u201d" : "")
                };
            });

            if (this._oCr.submitted_at) {
                aEvents.push({
                    ts: this._oCr.submitted_at,
                    title: "Submitted for approval",
                    meta: (this._oCr.requester || "\u2014") + " \u00b7 " + this._fmtDate(this._oCr.submitted_at)
                });
            }
            if (this._oCr.createdAt) {
                aEvents.push({
                    ts: this._oCr.createdAt,
                    title: "Request created",
                    meta: (this._oCr.requester || "\u2014") + " \u00b7 " + this._fmtDate(this._oCr.createdAt)
                });
            }

            aEvents.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });

            var oVBox = new VBox({ class: "sapUiSmallMargin" });
            if (!aEvents.length) {
                oVBox.addItem(new Text({ text: "No history recorded yet." }));
            } else {
                aEvents.forEach(function (ev) {
                    oVBox.addItem(new HBox({
                        class: "sapUiTinyMarginBottom",
                        items: [
                            new Icon({ src: "sap-icon://record", size: "0.7rem", class: "sapUiTinyMarginTop sapUiTinyMarginEnd" }),
                            new VBox({ items: [
                                new Text({ text: ev.title, class: "mdmScopeTitle" }),
                                new Text({ text: ev.meta })
                            ] })
                        ]
                    }));
                });
            }

            return new IconTabFilter({
                key: "__history", text: "History", icon: "sap-icon://history",
                content: [oVBox]
            });
        },

        _buildTabs: function () {
            var oTabs = this.byId("approvalTabs");
            if (!oTabs) { return; }
            oTabs.destroyItems();

            var aGeneral = this._aCrFieldValues.filter(function (fv) { return !fv.role_id; });
            this._buildTabsForBucket(null, aGeneral, oTabs);

            var that = this;
            (this._aCrRoleIds || []).forEach(function (sRoleId) {
                var aRoleFvs = that._aCrFieldValues.filter(function (fv) { return fv.role_id === sRoleId; });
                that._buildTabsForBucket(sRoleId, aRoleFvs, oTabs);
            });

            oTabs.addItem(this._buildAttachmentsTab());
            oTabs.addItem(this._buildHistoryTab());

            var aItems = oTabs.getItems();
            if (aItems.length) { oTabs.setSelectedKey(aItems[0].getKey()); }
        },

        // ── Actions ───────────────────────────────────────────────────

        onApprove:  function () { this._openDecisionDialog("APPROVE"); },
        onReject:   function () { this._openDecisionDialog("REJECT"); },
        onSendBack: function () { this._openDecisionDialog("SEND_BACK"); },

        _openDecisionDialog: function (sAction) {
            var that = this;
            var mLabel = { APPROVE: "Approve", REJECT: "Reject", SEND_BACK: "Send Back" };
            var sTitle = mLabel[sAction] || sAction;
            var bCommentRequired = sAction !== "APPROVE";

            var oTextArea = new TextArea({
                rows: 3,
                width: "100%",
                placeholder: bCommentRequired ? "Comment (required)" : "Comment (optional)"
            });

            var oDialog = new Dialog({
                title: sTitle + " " + this._sCrId,
                contentWidth: "28rem",
                content: [
                    new Text({
                        text: bCommentRequired ? "Please explain why:" : "Add an optional comment:",
                        class: "sapUiSmallMarginBottom"
                    }),
                    oTextArea
                ],
                beginButton: new Button({
                    text: sTitle,
                    type: sAction === "APPROVE" ? "Accept" : "Reject",
                    press: function () {
                        var sComment = oTextArea.getValue().trim();
                        if (bCommentRequired && !sComment) {
                            oTextArea.setValueState("Error");
                            oTextArea.setValueStateText("A comment is required to " + sTitle.toLowerCase() + ".");
                            return;
                        }
                        oDialog.close();
                        that._submitDecision(sAction, sComment);
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: function () { oDialog.close(); }
                }),
                afterClose: function () { oDialog.destroy(); }
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        _submitDecision: function (sAction, sComment) {
            var oVm    = this._oViewModel;
            var oModel = this.getOwnerComponent().getModel();
            var sUrl   = oModel.getServiceUrl().replace(/\/$/, "") + "/approveReleaseStep";
            var that   = this;

            oVm.setProperty("/busy", true);

            fetch(sUrl, {
                method : "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body   : JSON.stringify({
                    cr_id: this._sCrId,
                    step_number: this._iStepNumber,
                    comment: sComment,
                    action: sAction
                })
            })
            .then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (e) {
                        throw new Error((e.error && e.error.message) || "HTTP " + r.status);
                    });
                }
                return r.json();
            })
            .then(function (oData) {
                var oResult = (oData && oData.value) ? oData.value : oData;
                MessageToast.show((oResult && oResult.message) || (that._sCrId + " " + sAction.toLowerCase() + "ed."));
                that.getOwnerComponent().getRouter().navTo("myApprovals");
            })
            .catch(function (oErr) {
                oVm.setProperty("/busy", false);
                MessageBox.error("Could not record decision: " + oErr.message);
            });
        },

        // ── Navigation ───────────────────────────────────────────────

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("myApprovals");
        }
    });
});
