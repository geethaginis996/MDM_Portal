sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "mdm/portal/controller/AssignFieldsHelper",
    "mdm/portal/controller/FieldAssignmentEditHelper"
], function (
    Controller, Fragment, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, AssignFieldsHelper, FieldAssignmentEditHelper
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.BPRoleDetail", Object.assign({}, AssignFieldsHelper, FieldAssignmentEditHelper, {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy             : false,
                isNew            : false,
                isDirty          : false,
                selectedTab      : "general",
                fieldCount       : "0",
                prereqCount      : "0",
                prereqRolesCount : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "assigned");
            this.getView().setModel(new JSONModel({ items: [] }), "prereq");
            this.getView().setModel(new JSONModel({ items: [] }), "prereqroles");

            this._loadLookups();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("bpRoleDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _loadLookups: function () {
            var oModel = this.getOwnerComponent().getModel();
            var oLookups = new JSONModel({ masterDataTypes: [] });
            this.getView().setModel(oLookups, "lookups");
            oModel.bindList("/MasterDataTypes", null, [new Sorter("sequence")])
                .requestContexts(0, 50)
                .then(function (aCtx) {
                    oLookups.setProperty("/masterDataTypes", aCtx.map(function (c) {
                        return { key: c.getProperty("master_data_type_id"), text: c.getProperty("description") };
                    }));
                }.bind(this));
        },

        // ── Master Data Type radio helpers ────────────────────────────
        // RadioButtonGroup has no selectedKey, so map the FK key <-> index
        // against this fixed list. formatScopeIndex resolves a key to the
        // matching button index (or an out-of-range index for no match, the
        // supported way to show the group with nothing selected); the result
        // is applied imperatively via setSelectedIndex() at the exact moment
        // account_scope becomes known (existing role loaded / new role
        // defaulted / role copied), rather than through a declarative binding.
        _mdtList: function () {
            return [
                { key: "CUSTOMER", text: "Customer" },
                { key: "VENDOR",   text: "Vendor" },
                { key: "BOTH",     text: "Both" }
            ];
        },
        _scopeLabel: function (sKey) {
            var m = { CUSTOMER: "Customer", VENDOR: "Vendor", BOTH: "Both" };
            return m[sKey] || "";
        },
        // Resolves an account_scope key to its button index. Called directly
        // (not as a binding formatter) wherever the radio selection needs to
        // be applied or read back.
        formatScopeIndex: function (sKey) {
            var aList = this._mdtList();
            for (var i = 0; i < aList.length; i++) {
                if (aList[i].key === sKey) { return i; }
            }
            return aList.length;
        },
        _getMDTKey: function () {
            var oGroup = this.byId("selMDT");
            var aList  = this._mdtList();
            if (!oGroup || !aList.length) { return ""; }
            var i = oGroup.getSelectedIndex();
            return (i >= 0 && i < aList.length) ? aList[i].key : "";
        },

        _onRouteMatched: function (oEvent) {
            var sRaw = decodeURIComponent(oEvent.getParameter("arguments").roleId);
            var sId = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();
            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("assigned").setProperty("/items", []);
            this.getView().getModel("prereq").setProperty("/items", []);
            this.getView().getModel("prereqroles").setProperty("/items", []);

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindRole(sId);
            }
        },

        _bindRole: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            var sPath = "/BPRoles('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $select        : "role_id,description,initial_bp_required,sequence,active,account_scope,master_data_type_master_data_type_id",
                    $expand        : "master_data_type($select=master_data_type_id,description)",
                    $$updateGroupId: "bpRoleUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);
                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load role: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Role not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);
                            this.byId("selMDT").setSelectedIndex(this.formatScopeIndex(oData.account_scope));
                        }.bind(this));
                    }.bind(this)
                }
            });
        },

        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  false);

            var oModel = this.getOwnerComponent().getModel();

            // Reset any pending changes and unbind the view first.
            // Without this, OData V4 carries over data from the previous
            // binding context into the new transient CREATE context.
            oModel.resetChanges("bpRoleUpdate");
            this.getView().unbindObject();

            // If a previous transient context exists (user navigated away
            // without saving), discard it before creating a new one.
            if (this._oCreateListBinding) {
                try { this._oCreateListBinding.destroy(); } catch (e) {}
                this._oCreateListBinding = null;
            }

            var oListBinding = oModel.bindList("/BPRoles", null, [], [], {
                $$updateGroupId: "bpRoleUpdate"
            });
            var oContext = oListBinding.create({
                role_id                             : "",
                description                         : "",
                master_data_type_master_data_type_id: "BUSINESS PARTNER",
                account_scope                       : "CUSTOMER",
                initial_bp_required                 : false,
                sequence                            : 1,
                active                              : true
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this.byId("selMDT").setSelectedIndex(this.formatScopeIndex("CUSTOMER"));
            this._refreshHeader({ role_id: "", description: "", active: true });

            // Explicitly clear the input fields to prevent stale values
            // from the previous route visit bleeding through
            var oRoleIdInput = this.byId("inId");
            var oDescInput   = this.byId("inDescription");
            var oSeqInput    = this.byId("inSequence");
            if (oRoleIdInput) { oRoleIdInput.setValue(""); }
            if (oDescInput)   { oDescInput.setValue(""); }
            if (oSeqInput)    { oSeqInput.setValue("1"); }
        },

        _refreshHeader: function (oData) {
            var sId   = oData.role_id || "";
            var sDesc = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " \u2014 " + sDesc : "")) : "New BP Role";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }
        },

        _truthy: function (v) {
            if (typeof v === "string") {
                var s = v.trim().toLowerCase();
                return (s === "yes" || s === "true" || s === "1" || s === "active" || s === "x");
            }
            return v === true || v === 1;
        },

        // ── Formatters for field status ──────────────────────────────
        formatStatusText: function (sStatus) {
            if (sStatus === "REQUIRED") { return "Required"; }
            if (sStatus === "OPTIONAL") { return "Optional"; }
            if (sStatus === "SUPPRESS") { return "Suppress"; }
            return sStatus || "—";
        },
        formatStatusState: function (sStatus) {
            if (sStatus === "REQUIRED") { return "Warning"; }
            if (sStatus === "OPTIONAL") { return "Information"; }
            if (sStatus === "SUPPRESS") { return "None"; }
            return "None";
        },

        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "fields")      { this._loadAssignedFields(); }
            if (sKey === "prereq")      { this._loadPrereqFields(); }
            if (sKey === "prereqroles") { this._loadPrereqRoles(); }
            if (sKey === "changelog")   { this._loadChangeLog(); }
        },

        _roleId: function () {
            var oCtx = this.getView().getBindingContext();
            return oCtx ? oCtx.getProperty("role_id") : null;
        },

        // ── Field Assignment tab ─────────────────────────────────────
        _loadAssignedFields: function () {
            var sRole = this._roleId();
            if (!sRole) { return; }
            var oModel = this.getOwnerComponent().getModel();

            // Prereq field set — to flag the Prerequisite column
            var pPrereq = oModel.bindList("/BPRolePrereqFields", null, null, [
                new Filter("role_role_id", FilterOperator.EQ, sRole)
            ], { $select: "field_field_id" }).requestContexts(0, Infinity)
                .then(function (aCtx) {
                    var oSet = {};
                    aCtx.forEach(function (c) { oSet[c.getProperty("field_field_id")] = true; });
                    return oSet;
                });

            pPrereq.then(function (oPrereqSet) {
                return oModel.bindList("/BPRoleFields", null,
                    [
                        new Sorter("field/main_group_group_id"),
                        new Sorter("field/sub_group_group_id"),
                        new Sorter("sequence")
                    ],
                    [new Filter("role_role_id", FilterOperator.EQ, sRole)],
                    {
                        $expand: "field($select=field_id,description,data_type,main_group_group_id,sub_group_group_id)",
                        $select: "role_role_id,field_field_id,field_status,sequence"
                    }
                ).requestContexts(0, Infinity).then(function (aCtx) {
                    // Guard against the view having been torn down while this
                    // async request was in flight — e.g. the user switched to
                    // a different role or navigated away right after opening
                    // the Field Assignment tab. Without this check, controls
                    // like the "fieldsTable" can be undefined here and crash
                    // with "Cannot read properties of undefined (reading 'setText')".
                    var oView = this.getView();
                    if (!oView || oView.bIsDestroyed) { return; }

                    var aItems = aCtx.map(function (c) {
                        var sMain = c.getProperty("field/main_group_group_id") || "";
                        var sSub  = c.getProperty("field/sub_group_group_id")  || "";
                        var sFid  = c.getProperty("field_field_id");
                        return {
                            field_id       : sFid,
                            description    : c.getProperty("field/description") || "",
                            data_type      : c.getProperty("field/data_type")   || "",
                            main_group     : sMain,
                            sub_group      : sSub,
                            // group_key drives the table's built-in grouping
                            group_key      : sMain + "||" + sSub,
                            group_path     : sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : ""),
                            field_status   : c.getProperty("field_status"),
                            sequence       : c.getProperty("sequence"),
                            is_prerequisite: !!oPrereqSet[sFid]
                        };
                    });

                    // Sort client-side: main group → sub group → sequence
                    aItems.sort(function (a, b) {
                        if (a.main_group < b.main_group) { return -1; }
                        if (a.main_group > b.main_group) { return  1; }
                        if (a.sub_group  < b.sub_group)  { return -1; }
                        if (a.sub_group  > b.sub_group)  { return  1; }
                        return (a.sequence || 0) - (b.sequence || 0);
                    });

                    this.getView().getModel("assigned").setProperty("/items", aItems);
                    this._oViewModel.setProperty("/fieldCount", String(aItems.length));

                    // Apply grouping to the table binding
                    this._applyFieldTableGrouping();
                }.bind(this));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load assigned fields: " + e.message);
            });
        },

        // Apply group header rows to the Field Assignment table by
        // rebinding with a Sorter that triggers UI5's groupHeaderFactory.
        _applyFieldTableGrouping: function () {
            var oTable = this.byId("fieldsTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }

            oBinding.sort([
                new Sorter("main_group",  false, function (oCtx) {
                    // Group by main+sub — return object with key and text for the header
                    var sMain = oCtx.getProperty("main_group") || "\u2014";
                    var sSub  = oCtx.getProperty("sub_group")  || "";
                    var sKey  = oCtx.getProperty("group_key");
                    // Count how many items share this group (approximate — UI5 passes count to factory)
                    return {
                        key : sKey,
                        text: sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : "")
                    };
                }),
                new Sorter("sequence")
            ]);
        },

        // ── Field group header factory ────────────────────────────────
        // Called by sap.m.Table for each group boundary when the binding
        // has a Sorter with group: true.  oGroup.key = "MAIN||SUB".
        // Returns a GroupHeaderListItem showing the wireframe style header.
        createFieldGroupHeader: function (oGroup) {
            var sKey   = oGroup.key  || "";
            var iCount = oGroup.count || 0;
            // Reconstruct display text from the key
            var aParts = sKey.split("||");
            var sMain  = aParts[0] || "\u2014";
            var sSub   = aParts[1] || "";
            var sDisplay = sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : "");
            var sTitle   = sDisplay + (iCount ? "\u2002\u00b7\u2002" + iCount + " field" + (iCount !== 1 ? "s" : "") : "");
            return new sap.m.GroupHeaderListItem({
                title    : sTitle,
                upperCase: false
            });
        },

        // ── Prerequisite Fields tab ──────────────────────────────────
        _loadPrereqFields: function () {
            var sRole = this._roleId();
            if (!sRole) { return; }
            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/BPRolePrereqFields", null, [new Sorter("sequence")], [
                new Filter("role_role_id", FilterOperator.EQ, sRole)
            ], {
                $expand: "field($select=field_id,description,data_type,main_group_group_id,sub_group_group_id)",
                $select: "role_role_id,field_field_id,sequence"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    var sMain = c.getProperty("field/main_group_group_id") || "";
                    var sSub  = c.getProperty("field/sub_group_group_id") || "";
                    return {
                        field_id   : c.getProperty("field_field_id"),
                        description: c.getProperty("field/description") || "",
                        data_type  : c.getProperty("field/data_type") || "",
                        group_path : (sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : "")) || "\u2014",
                        sequence   : c.getProperty("sequence")
                    };
                });
                this.getView().getModel("prereq").setProperty("/items", aItems);
                this._oViewModel.setProperty("/prereqCount", String(aItems.length));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load prerequisite fields: " + e.message);
            });
        },

        // ── Prerequisite Roles tab ───────────────────────────────────
        _loadPrereqRoles: function () {
            var sRole = this._roleId();
            if (!sRole) { return; }
            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/BPRoleDependencies", null, null, [
                new Filter("role_role_id", FilterOperator.EQ, sRole)
            ], {
                $expand: "prerequisite_role($select=role_id,description,account_scope)",
                $select: "role_role_id,prerequisite_role_role_id,auto_pull"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    return {
                        role_id    : c.getProperty("prerequisite_role_role_id"),
                        description: c.getProperty("prerequisite_role/description") || "",
                        mdt        : this._scopeLabel(c.getProperty("prerequisite_role/account_scope")),
                        auto_pull  : c.getProperty("auto_pull")
                    };
                }.bind(this));
                this.getView().getModel("prereqroles").setProperty("/items", aItems);
                this._oViewModel.setProperty("/prereqRolesCount", String(aItems.length));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load prerequisite roles: " + e.message);
            });
        },

        // ── Removal: Field Assignment / Prerequisite Fields / Prerequisite Roles ──
        // Deletes a junction-table row identified by its composite key.
        // OData V4 composite-key delete: bind a list, request the specific context
        // by key predicate, then call context.delete() on the resolved context.
        _deleteJunctionRow: function (oConfig) {
            var oModel = this.getOwnerComponent().getModel();

            // Build key predicate filters to find the exact row
            var aFilters = Object.keys(oConfig.keys).map(function (k) {
                return new Filter(k, FilterOperator.EQ, oConfig.keys[k]);
            });
            var oFilter = aFilters.length === 1
                ? aFilters[0]
                : new Filter({ filters: aFilters, and: true });

            oModel.bindList(oConfig.collection, null, null, [oFilter])
                .requestContexts(0, 1)
                .then(function (aCtx) {
                    if (!aCtx || !aCtx.length) {
                        MessageToast.show("Row not found — already deleted?");
                        if (typeof oConfig.reload === "function") { oConfig.reload(); }
                        return;
                    }
                    return aCtx[0].delete("$auto").then(function () {
                        MessageToast.show("Removed.");
                        if (typeof oConfig.reload === "function") { oConfig.reload(); }
                    });
                })
                .catch(function (e) {
                    MessageBox.error("Could not remove: " + (e && e.message || "Unknown error"));
                });
        },

        onRemoveAssignedField: function (oEvent) {
            var oCtx     = oEvent.getSource().getBindingContext("assigned");
            var sFieldId = oCtx.getProperty("field_id");
            MessageBox.confirm("Remove \u201c" + sFieldId + "\u201d from this role's Field Assignment?", {
                title  : "Remove Field",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    this._deleteJunctionRow({
                        collection: "/BPRoleFields",
                        keys      : { role_role_id: this._roleId(), field_field_id: sFieldId },
                        reload    : this._loadAssignedFields.bind(this)
                    });
                }.bind(this)
            });
        },

        onRemovePrereqField: function (oEvent) {
            var oCtx     = oEvent.getSource().getBindingContext("prereq");
            var sFieldId = oCtx.getProperty("field_id");
            MessageBox.confirm("Remove \u201c" + sFieldId + "\u201d from the prerequisite fields?", {
                title  : "Remove Prerequisite Field",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    this._deleteJunctionRow({
                        collection: "/BPRolePrereqFields",
                        keys      : { role_role_id: this._roleId(), field_field_id: sFieldId },
                        reload    : this._loadPrereqFields.bind(this)
                    });
                }.bind(this)
            });
        },

        onRemovePrereqRole: function (oEvent) {
            var oCtx    = oEvent.getSource().getBindingContext("prereqroles");
            var sRoleId = oCtx.getProperty("role_id");
            MessageBox.confirm("Remove \u201c" + sRoleId + "\u201d as a prerequisite role?", {
                title  : "Remove Prerequisite Role",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    this._deleteJunctionRow({
                        collection: "/BPRoleDependencies",
                        keys      : { role_role_id: this._roleId(), prerequisite_role_role_id: sRoleId },
                        reload    : this._loadPrereqRoles.bind(this)
                    });
                }.bind(this)
            });
        },

        _loadChangeLog: function () {
            var sRole = this._roleId();
            if (!sRole) { return; }

            // Populate managed-field strip from the entity binding context
            var oCtx = this.getView().getBindingContext();
            if (oCtx) {
                this._oViewModel.setProperty("/clCreatedAt",  this._fmtDate(oCtx.getProperty("createdAt")));
                this._oViewModel.setProperty("/clCreatedBy",  oCtx.getProperty("createdBy")  || "\u2014");
                this._oViewModel.setProperty("/clModifiedAt", this._fmtDate(oCtx.getProperty("modifiedAt")));
                this._oViewModel.setProperty("/clModifiedBy", oCtx.getProperty("modifiedBy") || "\u2014");
            }

            var oBinding = this.byId("logTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "BPRole"),
                new Filter("entity_key",  FilterOperator.EQ, sRole)
            ]);
            oBinding.sort(new Sorter("acted_at", true));
            oBinding.resume();
        },

        _fmtDate: function (sVal) {
            if (!sVal) { return "\u2014"; }
            try { return new Date(sVal).toLocaleString(); } catch (e) { return sVal; }
        },

        // ── Row navigation ───────────────────────────────────────────
        onFieldRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this._openFieldAssignmentEdit({
                collection   : "/BPRoleFields",
                fkName       : "role_role_id",
                fkValue      : this._roleId(),
                fieldId      : sFieldId,
                updateGroupId: "bpRoleUpdate",
                showReadOnly : true,
                onDone       : this._loadAssignedFields.bind(this)
            });
        },
        onFieldLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: encodeURIComponent(sFieldId.toLowerCase()) });
        },
        onPrereqLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("prereq").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: encodeURIComponent(sFieldId.toLowerCase()) });
        },
        onPrereqRolePress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext("prereqroles").getProperty("role_id");
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: encodeURIComponent(sId.toLowerCase()) });
        },
        onPrereqRoleLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext("prereqroles").getProperty("role_id");
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: encodeURIComponent(sId.toLowerCase()) });
        },

        // ── Add actions (stubs that point to where dialogs would go) ─
        onAssignFields: function () {
            var sRole = this._roleId();
            if (!sRole) { MessageToast.show("Save the role first."); return; }
            var aItems = this.getView().getModel("assigned").getProperty("/items") || [];
            var iMaxSeq = aItems.reduce(function (m, o) {
                return Math.max(m, parseInt(o.sequence, 10) || 0);
            }, 0);
            this._openAssignFields({
                collection   : "/BPRoleFields",
                fkName       : "role_role_id",
                fkValue      : sRole,
                updateGroupId: "bpRoleUpdate",
                assignedIds  : aItems.map(function (o) { return o.field_id; }),
                maxSequence  : iMaxSeq,
                includeStatus: true,
                dialogTitle  : "Assign Fields",
                extraProps   : function () { return { read_only: false }; },
                onDone       : this._loadAssignedFields.bind(this)
            });
        },
        onAddPrereq: function () {
            var sRole = this._roleId();
            if (!sRole) { MessageToast.show("Save the role first."); return; }
            var aItems = this.getView().getModel("prereq").getProperty("/items") || [];
            var iMaxSeq = aItems.reduce(function (m, o) {
                return Math.max(m, parseInt(o.sequence, 10) || 0);
            }, 0);
            this._openAssignFields({
                collection   : "/BPRolePrereqFields",
                fkName        : "role_role_id",
                fkValue       : sRole,
                updateGroupId : "bpRoleUpdate",
                assignedIds   : aItems.map(function (o) { return o.field_id; }),
                maxSequence   : iMaxSeq,
                includeStatus : false,
                dialogTitle   : "Add Prerequisite Fields",
                onDone        : this._loadPrereqFields.bind(this)
            });
        },
        onAddPrereqRole: function () {
            var sRole = this._roleId();
            if (!sRole) { MessageToast.show("Save the role first."); return; }

            var fnAfterLoad = function () {
                this._loadAvailablePrereqRoles().then(function () {
                    // Clear search field on every open
                    var oSearch = Fragment.byId(this.getView().getId(), "prereqRoleSearch");
                    if (oSearch) { oSearch.setValue(""); }
                    this._oPrereqRoleDialog.open();
                }.bind(this));
            }.bind(this);

            if (this._oPrereqRoleDialog) { fnAfterLoad(); return; }

            sap.ui.require(["sap/ui/core/Fragment"], function (Fragment) {
                Fragment.load({
                    id        : this.getView().getId(),
                    name      : "mdm.portal.view.fragment.AddPrereqRoleDialog",
                    controller: this
                }).then(function (oDialog) {
                    this._oPrereqRoleDialog = oDialog;
                    this.getView().addDependent(oDialog);
                    if (!this.getView().getModel("rdlg")) {
                        this.getView().setModel(new JSONModel({ availableRoles: [], allRoles: [] }), "rdlg");
                    }
                    fnAfterLoad();
                }.bind(this));
            }.bind(this));
        },

        // Load all active roles except the current one and already-added prereqs
        _loadAvailablePrereqRoles: function () {
            var oModel = this.getOwnerComponent().getModel();
            var sCurrent = this._roleId();
            var aExisting = this.getView().getModel("prereqroles").getProperty("/items") || [];
            var oExclude = {};
            oExclude[sCurrent] = true;
            aExisting.forEach(function (o) { oExclude[o.role_id] = true; });

            return oModel.bindList("/BPRoles", null, [new Sorter("role_id")], [
                new Filter("active", FilterOperator.EQ, true)
            ], {
                $select: "role_id,description,account_scope"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aAll = aCtx
                    .filter(function (c) { return !oExclude[c.getProperty("role_id")]; })
                    .map(function (c) {
                        return {
                            role_id    : c.getProperty("role_id"),
                            description: c.getProperty("description") || "",
                            mdt        : this._scopeLabel(c.getProperty("account_scope"))
                        };
                    }.bind(this));
                var oRdlg = this.getView().getModel("rdlg");
                oRdlg.setProperty("/allRoles", aAll);
                oRdlg.setProperty("/availableRoles", aAll);
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load roles: " + e.message);
            });
        },

        onRoleDialogSearch: function (oEvent) {
            var sQuery = (oEvent.getParameter("newValue") || "").toLowerCase();
            var oRdlg = this.getView().getModel("rdlg");
            var aAll = oRdlg.getProperty("/allRoles") || [];
            if (!sQuery) { oRdlg.setProperty("/availableRoles", aAll); return; }
            oRdlg.setProperty("/availableRoles", aAll.filter(function (o) {
                return o.role_id.toLowerCase().indexOf(sQuery) !== -1 ||
                       o.description.toLowerCase().indexOf(sQuery) !== -1;
            }));
        },

        onAddPrereqRoleConfirm: function () {
            var oTable = this.byId("dlgRolesTable");
            var aSelected = oTable ? oTable.getSelectedItems() : [];
            if (!aSelected.length) { MessageToast.show("Select at least one role."); return; }

            var bAutoPull = this.byId("dlgAutoPull").getSelected();
            var sRole     = this._roleId();
            var oModel    = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/BPRoleDependencies", null, [], [], {
                $$updateGroupId: "bpRoleUpdate"
            });

            aSelected.forEach(function (oItem) {
                var sPreId = oItem.getBindingContext("rdlg").getProperty("role_id");
                oListBinding.create({
                    role_role_id                 : sRole,
                    prerequisite_role_role_id    : sPreId,
                    auto_pull                    : bAutoPull
                });
            });

            oModel.submitBatch("bpRoleUpdate")
                .then(function () {
                    MessageToast.show(aSelected.length + " prerequisite role(s) added.");
                    this._oPrereqRoleDialog.close();
                    this._loadPrereqRoles();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not add prerequisite roles: " + (e.message || "Unknown error"));
                }.bind(this));
        },

        onAddPrereqRoleCancel: function () {
            if (this._oPrereqRoleDialog) { this._oPrereqRoleDialog.close(); }
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId   = this.byId("inId").getValue().trim().toUpperCase();
            var sDesc = this.byId("inDescription").getValue().trim();
            var sMDT  = this._getMDTKey();
            var sSeq  = this.byId("inSequence").getValue().trim();

            if (!sId) { MessageBox.error("BP Role Name is required."); return; }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Role Name must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sDesc) { MessageBox.error("Description is required."); return; }
            if (!sMDT) { MessageBox.error("Master Data Type is required."); return; }
            if (!sSeq || isNaN(parseInt(sSeq, 10))) { MessageBox.error("A valid Sequence is required."); return; }

            this._oViewModel.setProperty("/busy", true);
            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                if (bIsNew) { oCtx.setProperty("role_id", sId); }
                oCtx.setProperty("account_scope", sMDT);
                oCtx.setProperty("sequence", parseInt(sSeq, 10));
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("bpRoleUpdate")
                .then(function () {
                    if (bIsNew && oCtx && typeof oCtx.created === "function") {
                        var pCreated = oCtx.created();
                        if (pCreated && typeof pCreated.then === "function") {
                            return pCreated.then(function () { return true; });
                        }
                        return true;
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Role saved successfully.");
                    if (bWasCreated) {
                        // Delay slightly so the toast actually paints before the
                        // route change tears the page down.
                        this._oCreateListBinding = null;
                        setTimeout(this.onNavBack.bind(this), 300);
                    } else if (oCtx) {
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    MessageBox.error("Save failed: " + (oErr.message || "Unknown error"));
                }.bind(this));
        },

        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("bpRoleUpdate");
                this._oViewModel.setProperty("/isDirty", false);
                this.onNavBack();
            }.bind(this);
            if (this._oViewModel.getProperty("/isDirty")) {
                MessageBox.confirm("Discard unsaved changes?", {
                    onClose: function (sAction) { if (sAction === MessageBox.Action.OK) { fnGoBack(); } }
                });
            } else {
                fnGoBack();
            }
        },

        onCopy: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { MessageToast.show("No role selected to copy."); return; }
            this.getOwnerComponent().getModel().resetChanges("bpRoleUpdate");
            oCtx.requestObject().then(function (oData) {
                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/BPRoles", null, [], [], { $$updateGroupId: "bpRoleUpdate" });
                var oNewCtx = oListBinding.create({
                    role_id                             : "",
                    description                         : oData.description + " (Copy)",
                    master_data_type_master_data_type_id: oData.master_data_type_master_data_type_id || "BUSINESS PARTNER",
                    account_scope                       : oData.account_scope || "CUSTOMER",
                    initial_bp_required                 : oData.initial_bp_required,
                    sequence                            : (oData.sequence || 0) + 1,
                    active                              : false
                });
                this._oCreateListBinding = oListBinding;
                // Unbind the source record's object binding (set by the _bind* view
                // binding) before switching context; an object binding overrides
                // setBindingContext, otherwise the copy never appears.
                this.getView().unbindObject();
                this.getView().setBindingContext(oNewCtx);
                this._oViewModel.setProperty("/isNew",   true);
                this._oViewModel.setProperty("/isDirty", true);
                this.byId("selMDT").setSelectedIndex(this.formatScopeIndex(oData.account_scope || "CUSTOMER"));
                this._refreshHeader({ role_id: "", description: oData.description + " (Copy)", active: false });
                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Role copied — enter a new Role Name and press Save.");
            }.bind(this));
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("bpRoles");
        }
    }));
});