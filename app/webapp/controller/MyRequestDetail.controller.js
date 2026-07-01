sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Token",
    "sap/m/SegmentedButtonItem",
    "sap/m/IconTabFilter",
    "sap/m/Panel",
    "sap/m/Title",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/Input",
    "sap/m/Select",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/ObjectIdentifier",
    "sap/ui/core/Item",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Toolbar",
    "sap/m/ToolbarSpacer"
], function (
    Controller, JSONModel, MessageBox, MessageToast,
    Token, SegmentedButtonItem, IconTabFilter,
    Panel, Title, Label, Text, Input, Select,
    Table, Column, ColumnListItem, ObjectIdentifier, CoreItem,
    VBox, HBox, Toolbar, ToolbarSpacer
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.MyRequestDetail", {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy        : false,
                crId        : "",
                status      : "",
                type        : "",
                category    : "",
                accountGroup: "",
                numberRange : "",
                priority    : "",
                requester   : "",
                createdAt   : "",
                bpNumber    : "",
                subtitle    : "",
                roleCount   : 0,
                activeRole  : ""
            });
            this.getView().setModel(this._oViewModel, "view");

            // Stores the loaded data for re-rendering on role switch
            this._aRoles       = [];
            this._aFieldVals   = [];
            this._aAttachments = [];
            this._mSavedVals   = {};
            this._mRoleMeta    = {};
            this._mFieldMeta   = {};
            this._mGroupMeta   = {};

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("myRequestDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sCrId = decodeURIComponent(oEvent.getParameter("arguments").crId);
            this._loadCR(sCrId);
        },

        // ── Load CR data ─────────────────────────────────────────────

        _loadCR: function (sCrId) {
            var oVm    = this._oViewModel;
            var oModel = this.getOwnerComponent().getModel();
            oVm.setProperty("/busy", true);
            oVm.setProperty("/crId", sCrId);
            this._clearUI();

            var that   = this;
            var sBase  = oModel.getServiceUrl().replace(/\/$/, "");
            var sCrKey = "'" + encodeURIComponent(sCrId) + "'";

            var pHeader = fetch(sBase + "/ChangeRequests(" + sCrKey + ")",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); });

            var pRoles = fetch(
                sBase + "/CRBPRoles?$filter=cr_cr_id eq " + sCrKey +
                "&$select=cr_cr_id,role_role_id,instance_no,auto_pulled&$top=100",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) { return (d && d.value) || []; })
                .catch(function () { return []; });

            var pFvs = fetch(
                sBase + "/CRFieldValues?$filter=cr_cr_id eq " + sCrKey +
                "&$select=cr_cr_id,role_id,instance_no,field_field_id,new_value,prereq_indicator&$top=5000",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) { return (d && d.value) || []; })
                .catch(function () { return []; });

            // Also fetch attachments saved against this CR
            var pAtts = fetch(
                sBase + "/CRAttachments?$filter=cr_cr_id eq " + sCrKey +
                "&$select=attachment_id,file_name,size_bytes,mime_type,description,uploaded_by,uploaded_at&$top=200",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) { return (d && d.value) || []; })
                .catch(function () { return []; });

            Promise.all([pHeader, pRoles, pFvs, pAtts])
            .then(function (aResults) {
                var oData  = aResults[0];
                var aRoles = aResults[1];
                var aFvs   = aResults[2];
                var aAtts  = aResults[3];

                oVm.setProperty("/busy",         false);
                oVm.setProperty("/status",       oData.status       || "\u2014");
                oVm.setProperty("/type",         oData.request_type || "\u2014");
                oVm.setProperty("/category",     oData.bp_category_category_id        || "\u2014");
                oVm.setProperty("/accountGroup", oData.account_group_account_group_id || "\u2014");
                oVm.setProperty("/priority",     oData.priority     || "NORMAL");
                oVm.setProperty("/requester",    oData.requester    || "\u2014");
                oVm.setProperty("/bpNumber",     oData.posted_object_no || "\u2014");
                oVm.setProperty("/createdAt",    oData.createdAt
                    ? new Date(oData.createdAt).toLocaleString() : "\u2014");
                oVm.setProperty("/subtitle",
                    (oData.request_type || "") + " \u00b7 " +
                    (oData.bp_category_category_id || "") + " \u00b7 " +
                    (oData.status || ""));

                // Fetch Number Range from AccountGroup
                var sAg = oData.account_group_account_group_id;
                if (sAg) {
                    fetch(sBase + "/AccountGroups('" + encodeURIComponent(sAg) + "')?$select=account_group_id,number_range_id,description",
                        { headers: { Accept: "application/json" } })
                    .then(function (r) { return r.json(); })
                    .then(function (ag) {
                        var sNr = ag.number_range_id
                            ? ag.number_range_id + (ag.description ? " \u2014 " + ag.description : "")
                            : "\u2014";
                        oVm.setProperty("/numberRange", sNr);
                    }).catch(function () { oVm.setProperty("/numberRange", "\u2014"); });
                }

                that._aRoles = aRoles.map(function (r) {
                    return {
                        role_id    : r.role_role_id || r.role_id || "",
                        instance_no: r.instance_no,
                        auto_pulled: !!r.auto_pulled
                    };
                });

                // Store attachments for the Attachments tab
                that._aAttachments = aAtts.map(function (a) {
                    return {
                        attachment_id: a.attachment_id,
                        file_name    : a.file_name    || "",
                        size_bytes   : a.size_bytes   || 0,
                        mime_type    : a.mime_type    || "",
                        description  : a.description  || "",
                        uploaded_by  : a.uploaded_by  || "",
                        uploaded_at  : a.uploaded_at
                            ? new Date(a.uploaded_at).toLocaleString() : ""
                    };
                });

                // Build a lookup map of saved values:
                // { "roleId|fieldId" → { new_value, prereq_indicator } }
                var mSavedVals = {};
                aFvs.forEach(function (fv) {
                    var sKey = (fv.role_id || "") + "|" + (fv.field_field_id || fv.field_id || "");
                    mSavedVals[sKey] = {
                        new_value       : fv.new_value        || "",
                        prereq_indicator: !!fv.prereq_indicator
                    };
                });
                that._mSavedVals = mSavedVals;

                oVm.setProperty("/roleCount", that._aRoles.length);

                // Now fetch ALL BPRoleFields for every resolved role so we can
                // show all assigned fields (not just the ones that were saved),
                // exactly mirroring the Edit Draft form layout.
                var aRoleIds = [];
                that._aRoles.forEach(function (r) {
                    if (aRoleIds.indexOf(r.role_id) < 0) { aRoleIds.push(r.role_id); }
                });

                var sRoleFilter = aRoleIds.map(function (id) {
                    return "role_role_id eq '" + id + "'";
                }).join(" or ");

                var pRoleFields = aRoleIds.length
                    ? fetch(sBase + "/BPRoleFields?$filter=" + encodeURIComponent(sRoleFilter) +
                        "&$select=role_role_id,field_field_id,field_status,sequence,read_only" +
                        "&$orderby=role_role_id,sequence&$top=5000",
                        { headers: { Accept: "application/json" } })
                        .then(function (r) { return r.json(); })
                        .then(function (d) { return (d && d.value) || []; })
                        .catch(function () { return []; })
                    : Promise.resolve([]);

                // Also fetch prereq fields per role
                var pPrereqFields = aRoleIds.length
                    ? fetch(sBase + "/BPRolePrereqFields?$filter=" + encodeURIComponent(sRoleFilter) +
                        "&$select=role_role_id,field_field_id,sequence&$top=500",
                        { headers: { Accept: "application/json" } })
                        .then(function (r) { return r.json(); })
                        .then(function (d) { return (d && d.value) || []; })
                        .catch(function () { return []; })
                    : Promise.resolve([]);

                Promise.all([pRoleFields, pPrereqFields]).then(function (aRf) {
                    var aRoleFieldRows = aRf[0];
                    var aPrereqRows    = aRf[1];

                    // Build prereq set: { "roleId|fieldId": true }
                    var mPrereqSet = {};
                    aPrereqRows.forEach(function (pf) {
                        mPrereqSet[pf.role_role_id + "|" + pf.field_field_id] = true;
                    });

                    // Build the complete field list per role, overlaying saved values
                    that._aFieldVals = aRoleFieldRows
                        .filter(function (rf) { return rf.field_status !== "SUPPRESS"; })
                        .map(function (rf) {
                            var sRoleId  = rf.role_role_id;
                            var sFieldId = rf.field_field_id;
                            var sKey     = sRoleId + "|" + sFieldId;
                            var oSaved   = that._mSavedVals[sKey] || {};
                            var bPrereq  = !!mPrereqSet[sKey];
                            return {
                                role_id         : sRoleId,
                                field_id        : sFieldId,
                                new_value       : oSaved.new_value || "",
                                instance_no     : 1,
                                prereq_indicator: bPrereq,
                                field_status    : rf.field_status  || "OPTIONAL",
                                sequence        : rf.sequence      || 99
                            };
                        });

                    console.log("[Detail] roleFields:", that._aFieldVals.length,
                        "savedVals:", Object.keys(that._mSavedVals).length);

                    // Load FieldMaster + FieldGroup metadata, then render
                    that._loadMeta(sBase);
                });

            }).catch(function (oErr) {
                oVm.setProperty("/busy", false);
                MessageBox.error("Could not load change request: " +
                    ((oErr && oErr.message) || String(oErr)));
            });
        },

        _loadMeta: function (sBase) {
            var that = this;

            var pRoles = fetch(sBase + "/BPRoles?$select=role_id,description",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    ((d && d.value) || []).forEach(function (r) {
                        that._mRoleMeta[r.role_id] = r.description || "";
                    });
                }).catch(function () {});

            // Full FieldMaster metadata — need main_group and sub_group for tab grouping.
            // Note: do NOT restrict $select on association FK scalars — CAP OData V4
            // may omit them when $selected on the flat entity projection. Instead
            // fetch the minimal set that guarantees the FK scalars are included.
            var pFields = fetch(sBase + "/FieldMasters?$select=field_id,description,main_group_group_id,sub_group_group_id&$top=2000",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    ((d && d.value) || []).forEach(function (f) {
                        that._mFieldMeta[f.field_id] = {
                            description : f.description            || "",
                            // Default to "GD" (General Data) when null —
                            // matches CreateBP.controller.js line 917 behaviour
                            mainGroup   : f.main_group_group_id    || "GD",
                            subGroup    : f.sub_group_group_id     || ""
                        };
                    });
                    // Debug: log a few sample fields to verify group IDs are arriving
                    ["NAME1","NAME2","PARTNER","COUNTRY","CITY"].forEach(function (id) {
                        if (that._mFieldMeta[id]) {
                            console.log("[Detail] " + id + " mainGroup:", that._mFieldMeta[id].mainGroup);
                        }
                    });
                }).catch(function () {});

            // FieldGroup metadata — for tab/panel labels
            var pGroups = fetch(sBase + "/FieldGroups?$select=group_id,description,parent_group_id_group_id,sequence,icon&$top=500",
                { headers: { Accept: "application/json" } })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    that._mGroupMeta = {};
                    ((d && d.value) || []).forEach(function (g) {
                        that._mGroupMeta[g.group_id] = {
                            description: g.description                || g.group_id,
                            parentId   : g.parent_group_id_group_id  || null,
                            sequence   : g.sequence                   || 99,
                            icon       : g.icon                       || "sap-icon://form"
                        };
                    });
                }).catch(function () { that._mGroupMeta = {}; });

            Promise.all([pRoles, pFields, pGroups]).then(function () {
                that._renderAll();
            });
        },

        // ── Render role switcher + tabs ───────────────────────────────

        _clearUI: function () {
            var oBar   = this.byId("detailRoleBar");
            var oTabs  = this.byId("detailRoleTabs");
            var oMulti = this.byId("inDetailRoles");
            if (oBar)   { oBar.destroyItems(); }
            if (oTabs)  { oTabs.destroyItems(); }
            if (oMulti) { oMulti.removeAllTokens(); }
            this._oViewModel.setProperty("/activeRole", "");
            this._oViewModel.setProperty("/numberRange", "");
        },

        _renderAll: function () {
            var oBar  = this.byId("detailRoleBar");
            var oTabs = this.byId("detailRoleTabs");
            if (!oBar || !oTabs) { return; }

            oBar.destroyItems();
            oTabs.destroyItems();

            // Dedupe roles preserving order
            var aRoleIds = [];
            this._aRoles.forEach(function (r) {
                if (aRoleIds.indexOf(r.role_id) < 0) { aRoleIds.push(r.role_id); }
            });

            if (!aRoleIds.length) {
                oTabs.addItem(new IconTabFilter({
                    key : "__empty",
                    text: "No roles saved",
                    content: [new Text({ text: "No field data found for this change request." })]
                }));
                return;
            }

            var oVm = this._oViewModel;

            // Build SegmentedButton items for role switching (only if > 1 role)
            aRoleIds.forEach(function (sRoleId) {
                var sDesc = this._mRoleMeta[sRoleId] || sRoleId;
                oBar.addItem(new SegmentedButtonItem({
                    key : sRoleId,
                    text: sRoleId + " \u2014 " + sDesc
                }));
            }.bind(this));

            // Select first role
            var sFirst = aRoleIds[0];
            oVm.setProperty("/activeRole", sFirst);
            if (aRoleIds.length > 1) { oBar.setSelectedKey(sFirst); }

            // Build role token chips in the MultiInput header field
            this._buildRoleTokens(aRoleIds);

            // Build tab content for the first active role
            this._buildRoleTabs(sFirst, oTabs);

            // ── Attachments tab — CR-level, added once here (not per role switch)
            // so it never duplicates when the user clicks a different role tab.
            oTabs.addItem(this._buildAttachmentsTab());
        },

        // Build Token chips in the read-only MultiInput showing selected roles
        _buildRoleTokens: function (aRoleIds) {
            var oMulti = this.byId("inDetailRoles");
            if (!oMulti) { return; }
            oMulti.removeAllTokens();
            var that = this;
            aRoleIds.forEach(function (sRoleId) {
                var sDesc = that._mRoleMeta[sRoleId] || "";
                var sText = sRoleId + (sDesc ? " \u2014 " + sDesc : "");
                oMulti.addToken(new sap.m.Token({ key: sRoleId, text: sText }));
            });
        },

        _buildRoleTabs: function (sRoleId, oTabs) {
            oTabs.destroyItems();

            var that    = this;
            var aAllFvs = this._aFieldVals.filter(function (fv) {
                return fv.role_id === sRoleId;
            });

            if (!aAllFvs.length) {
                oTabs.addItem(new IconTabFilter({
                    key    : "__empty",
                    text   : "No Values",
                    icon   : "sap-icon://form",
                    content: [new Text({
                        text : "No field values were saved for this role.",
                        class: "sapUiSmallMargin"
                    })]
                }));
                return;
            }

            // ── Prerequisite tab ──────────────────────────────────────
            var aPrereqs = aAllFvs.filter(function (fv) { return fv.prereq_indicator; });
            if (aPrereqs.length) {
                var oPrereqVBox = new VBox({ class: "sapUiSmallMarginTop" });
                oPrereqVBox.addItem(new Text({
                    text : "Required before proceeding (" + aPrereqs.length +
                           " field" + (aPrereqs.length > 1 ? "s" : "") + ")",
                    class: "sapUiSmallMargin"
                }));
                aPrereqs.forEach(function (fv) {
                    oPrereqVBox.addItem(that._buildFieldRow(fv));
                });
                oTabs.addItem(new IconTabFilter({
                    key    : "__prereqs",
                    text   : "Prerequisites",
                    icon   : "sap-icon://key",
                    count  : String(aPrereqs.length),
                    content: [oPrereqVBox]
                }));
            }

            // ── Regular fields: resolve true main-group tab ───────────
            //
            // FieldMaster.main_group_group_id can point to EITHER:
            //   (a) a true main group  (no parent)  → e.g. GD, AD, FIN
            //   (b) a sub-group (has a parent)       → e.g. GD_NAME (parent=GD),
            //                                          AD_LOC  (parent=AD)
            //
            // In case (b) the true tab is the parent, and main_group itself
            // becomes the sub-group panel — matching exactly how Create BP's
            // _renderTabsForActiveRole groups fields.
            //
            // Build: { trueMainGroupId → { subGroupId → [fv,...] } }
            var mMainGroups = {};
            var aMainOrder  = [];

            var aRegular = aAllFvs.filter(function (fv) { return !fv.prereq_indicator; });

            aRegular.forEach(function (fv) {
                var oFm       = that._mFieldMeta[fv.field_id] || {};
                var sMainRef  = oFm.mainGroup || "GD";   // default "GD" like CreateBP does

                // Resolve: if sMainRef itself has a parent → sMainRef is a sub-group,
                // parent is the real tab. Otherwise sMainRef IS the tab.
                var oMainMeta = that._mGroupMeta[sMainRef]   || {};
                var sTrueTab  = oMainMeta.parentId ? oMainMeta.parentId : sMainRef;
                var sSubPanel = sMainRef;  // panel inside the tab

                if (!mMainGroups[sTrueTab]) {
                    mMainGroups[sTrueTab] = {};
                    aMainOrder.push(sTrueTab);
                }
                if (!mMainGroups[sTrueTab][sSubPanel]) {
                    mMainGroups[sTrueTab][sSubPanel] = [];
                }
                mMainGroups[sTrueTab][sSubPanel].push(fv);
            });

            // Sort tabs by the true main group's sequence
            aMainOrder.sort(function (a, b) {
                var seqA = (that._mGroupMeta[a] && that._mGroupMeta[a].sequence) || 99;
                var seqB = (that._mGroupMeta[b] && that._mGroupMeta[b].sequence) || 99;
                return seqA - seqB;
            });

            aMainOrder.forEach(function (sTrueTab) {
                var oTabMeta  = that._mGroupMeta[sTrueTab] || {};
                var sTabLabel = oTabMeta.description || sTrueTab.replace(/_/g, " ");
                var sTabIcon  = oTabMeta.icon        || "sap-icon://form";
                var mSubs     = mMainGroups[sTrueTab];

                // Count total fields in this tab
                var iTotal = 0;
                Object.keys(mSubs).forEach(function (k) { iTotal += mSubs[k].length; });

                var oTabVBox = new VBox({ class: "sapUiSmallMarginTop" });

                // Sort sub-group panels by their own sequence
                var aSubKeys = Object.keys(mSubs).sort(function (a, b) {
                    var seqA = (that._mGroupMeta[a] && that._mGroupMeta[a].sequence) || 99;
                    var seqB = (that._mGroupMeta[b] && that._mGroupMeta[b].sequence) || 99;
                    return seqA - seqB;
                });

                aSubKeys.forEach(function (sSubKey) {
                    var aFvsInSub = mSubs[sSubKey];
                    var oSubMeta  = that._mGroupMeta[sSubKey] || {};
                    var sSubLabel = oSubMeta.description || sSubKey.replace(/_/g, " ");

                    // If sub-group = tab (field pointed directly at main group),
                    // skip the extra panel and just render fields directly
                    var bDirectInTab = (sSubKey === sTrueTab);

                    if (bDirectInTab) {
                        var oDirectVBox = new VBox({
                            class: "sapUiSmallMarginBeginEnd sapUiSmallMarginTopBottom"
                        });
                        aFvsInSub.forEach(function (fv) {
                            oDirectVBox.addItem(that._buildFieldRow(fv));
                        });
                        oTabVBox.addItem(oDirectVBox);
                    } else {
                        // Collapsible panel: "Name Data (2)" — matching Create BP's sub-group panel
                        var oPanel = new Panel({
                            headerText : sSubLabel + " (" + aFvsInSub.length + ")",
                            expandable : true,
                            expanded   : true,
                            class      : "sapUiSmallMarginBottom"
                        });
                        var oPanelVBox = new VBox({
                            class: "sapUiSmallMarginBeginEnd sapUiSmallMarginTopBottom"
                        });
                        aFvsInSub.forEach(function (fv) {
                            oPanelVBox.addItem(that._buildFieldRow(fv));
                        });
                        oPanel.addContent(oPanelVBox);
                        oTabVBox.addItem(oPanel);
                    }
                });

                oTabs.addItem(new IconTabFilter({
                    key    : sTrueTab,
                    text   : sTabLabel,
                    icon   : sTabIcon,
                    count  : String(iTotal),
                    content: [oTabVBox]
                }));
            });

            // Select first tab
            var aItems = oTabs.getItems();
            if (aItems.length) { oTabs.setSelectedKey(aItems[0].getKey()); }
        },

        // Build a read-only Attachments tab showing uploaded files
        _buildAttachmentsTab: function () {
            var aAtts = this._aAttachments || [];

            var oVBox = new VBox({ class: "sapUiSmallMargin" });

            oVBox.addItem(new Text({
                text : "Supporting documents attached to this change request.",
                class: "sapUiSmallMarginBottom"
            }));

            if (!aAtts.length) {
                oVBox.addItem(new Text({
                    text : "No attachments.",
                    class: "sapUiTinyMarginTop"
                }));
            } else {
                // Build a simple table matching the Create BP Attachments layout
                var oTable = new Table({
                    alternateRowColors: true,
                    columns: [
                        new Column({ header: new Label({ text: "File Name",    design: "Bold" }) }),
                        new Column({ header: new Label({ text: "Size",         design: "Bold" }), hAlign: "End", width: "7rem" }),
                        new Column({ header: new Label({ text: "Type",         design: "Bold" }), width: "8rem"  }),
                        new Column({ header: new Label({ text: "Uploaded By",  design: "Bold" }), width: "9rem"  }),
                        new Column({ header: new Label({ text: "Uploaded On",  design: "Bold" }), width: "12rem" })
                    ]
                });

                aAtts.forEach(function (a) {
                    // Format file size the same way CreateBP does
                    var sSize;
                    if (a.size_bytes < 1024)             { sSize = a.size_bytes + " B"; }
                    else if (a.size_bytes < 1024 * 1024) { sSize = Math.round(a.size_bytes / 1024) + " KB"; }
                    else                                  { sSize = (a.size_bytes / (1024 * 1024)).toFixed(1) + " MB"; }

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
                key    : "__attachments",
                text   : "Attachments",
                icon   : "sap-icon://attachment",
                count  : aAtts.length ? String(aAtts.length) : "",
                content: [oVBox]
            });
        },

        // Build one read-only field row: Label (FIELD_ID:*) + disabled Input (value)
        _buildFieldRow: function (fv) {
            var oFm       = this._mFieldMeta[fv.field_id] || {};
            var bRequired = (fv.field_status === "REQUIRED");
            var sLabel    = fv.field_id + ":";

            return new HBox({
                alignItems: "Center",
                class     : "sapUiTinyMarginBottom",
                items     : [
                    new Label({
                        text    : sLabel,
                        required: bRequired,
                        tooltip : oFm.description || "",
                        width   : "14rem",
                        class   : "sapUiTinyMarginEnd"
                    }),
                    new Input({
                        value       : fv.new_value || "",
                        editable    : false,
                        width       : "22rem",
                        placeholder : fv.new_value ? "" : "(not filled)",
                        valueState  : (bRequired && !fv.new_value) ? "Warning" : "None"
                    })
                ]
            });
        },

        // ── Role switcher ─────────────────────────────────────────────

        onDetailRoleChange: function (oEvent) {
            var sKey  = oEvent.getParameter("key");
            this._oViewModel.setProperty("/activeRole", sKey);

            var oTabs = this.byId("detailRoleTabs");
            // Remove all tabs EXCEPT the Attachments tab (last item — we don't
            // want to rebuild it on every role switch since it's CR-level)
            var aItems    = oTabs.getItems();
            var oAttsTab  = aItems[aItems.length - 1]; // save the Attachments tab
            oTabs.destroyItems();

            // Rebuild field tabs for the newly active role
            this._buildRoleTabs(sKey, oTabs);

            // Re-add the preserved Attachments tab at the end
            if (oAttsTab) { oTabs.addItem(oAttsTab); }
        },

        onDetailTabChange: function () { /* tabs are static per role */ },

        // ── Actions ───────────────────────────────────────────────────

        onEditDraft: function () {
            var sCrId  = this._oViewModel.getProperty("/crId");
            var sStatus = this._oViewModel.getProperty("/status");
            if (sStatus !== "DRAFT") {
                MessageBox.warning("Only DRAFT requests can be edited.");
                return;
            }
            this.getOwnerComponent().getRouter().navTo("createBPEdit", {
                crId: encodeURIComponent(sCrId)
            });
        },

        onSubmit: function () {
            var sCrId = this._oViewModel.getProperty("/crId");
            MessageBox.confirm("Submit change request " + sCrId + " for approval?", {
                title   : "Submit",
                actions : [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose : function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        MessageToast.show("Submit action — coming in next sprint");
                    }
                }
            });
        },

        onCancelRequest: function () {
            var oVm    = this._oViewModel;
            var sCrId  = oVm.getProperty("/crId");
            var sStatus = oVm.getProperty("/status");

            var sTitle, sMsg;
            if (sStatus === "DRAFT") {
                sTitle = "Delete Draft";
                sMsg   = "Permanently delete draft request " + sCrId + "?\n\nThis cannot be undone.";
            } else {
                sTitle = "Cancel Request";
                sMsg   = "Cancel request " + sCrId + "?\n\nThe request will be marked as Cancelled.";
            }

            MessageBox.confirm(sMsg, {
                title           : sTitle,
                icon            : MessageBox.Icon.WARNING,
                actions         : [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.NO,
                onClose         : function (sAction) {
                    if (sAction !== MessageBox.Action.YES) { return; }
                    this._deleteOrCancelCR(sCrId);
                }.bind(this)
            });
        },

        _deleteOrCancelCR: function (sCrId) {
            var oVm    = this._oViewModel;
            var oModel = this.getOwnerComponent().getModel();
            var sUrl   = oModel.getServiceUrl().replace(/\/$/, "") + "/DeleteChangeRequest";

            oVm.setProperty("/busy", true);

            fetch(sUrl, {
                method : "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body   : JSON.stringify({ cr_id: sCrId, reason: "" })
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
                oVm.setProperty("/busy", false);
                MessageToast.show(oData.value && oData.value.message
                    ? oData.value.message : sCrId + " removed successfully.");
                this.getOwnerComponent().getRouter().navTo("myRequests");
            }.bind(this))
            .catch(function (oErr) {
                oVm.setProperty("/busy", false);
                MessageBox.error("Could not remove request: " + oErr.message);
            }.bind(this));
        },

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("home", {}, true);
        },

        onNavList: function () {
            this.getOwnerComponent().getRouter().navTo("myRequests");
        }
    });
});