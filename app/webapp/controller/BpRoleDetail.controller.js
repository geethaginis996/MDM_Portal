sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.BPRoleDetail", {

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
                });
        },

        _onRouteMatched: function (oEvent) {
            var sId = decodeURIComponent(oEvent.getParameter("arguments").roleId);
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
                            var oSel = this.byId("selMDT");
                            if (oSel) { oSel.setSelectedKey(oData.master_data_type_master_data_type_id); }
                        }.bind(this));
                    }.bind(this)
                }
            });
        },

        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  false);

            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/BPRoles", null, [], [], {
                $$updateGroupId: "bpRoleUpdate"
            });
            var oContext = oListBinding.create({
                role_id                             : "",
                description                         : "",
                master_data_type_master_data_type_id: "",
                initial_bp_required                 : false,
                sequence                            : 1,
                active                              : true
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this._refreshHeader({ role_id: "", description: "", active: true });
        },

        _refreshHeader: function (oData) {
            var sId   = oData.role_id || "";
            var sDesc = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " — " + sDesc : "")) : "New BP Role";
            this.byId("pageTitle").setText(sTitle);

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) { oBreadcrumb.setCurrentLocationText(sId || "New BP Role"); }

            var sMDT = (oData.master_data_type && oData.master_data_type.description) || "";
            this.byId("pageSubtitle").setText("Role ID: " + (sId || "—") + (sMDT ? " · Master Data Type: " + sMDT : ""));

            var bActive = this._truthy(oData.active);
            this.byId("attrStatus").setText(bActive ? "Active" : "Inactive");
            this.byId("attrStatus").setState(bActive ? "Success" : "Error");
            this.byId("attrMDT").setText(sMDT || "—");
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
            // Prereq field set, to flag the is_prerequisite column
            var pPrereq = oModel.bindList("/BPRolePrereqFields", null, null, [
                new Filter("role_role_id", FilterOperator.EQ, sRole)
            ], { $select: "field_field_id" }).requestContexts(0, Infinity)
                .then(function (aCtx) {
                    var oSet = {};
                    aCtx.forEach(function (c) { oSet[c.getProperty("field_field_id")] = true; });
                    return oSet;
                });

            pPrereq.then(function (oPrereqSet) {
                return oModel.bindList("/BPRoleFields", null, [new Sorter("sequence")], [
                    new Filter("role_role_id", FilterOperator.EQ, sRole)
                ], {
                    $expand: "field($select=field_id,description,data_type,main_group_group_id,sub_group_group_id)",
                    $select: "role_role_id,field_field_id,field_status,sequence"
                }).requestContexts(0, Infinity).then(function (aCtx) {
                    var aItems = aCtx.map(function (c) {
                        // Read nested fields via path notation — OData v4 rejects
                        // getProperty("field") on the expanded object itself.
                        var sMain = c.getProperty("field/main_group_group_id") || "";
                        var sSub  = c.getProperty("field/sub_group_group_id") || "";
                        var sPath = sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : "");
                        var sFid  = c.getProperty("field_field_id");
                        return {
                            field_id       : sFid,
                            description    : c.getProperty("field/description") || "",
                            data_type      : c.getProperty("field/data_type") || "",
                            group_path     : sPath || "\u2014",
                            field_status   : c.getProperty("field_status"),
                            sequence       : c.getProperty("sequence"),
                            is_prerequisite: !!oPrereqSet[sFid]
                        };
                    });
                    this.getView().getModel("assigned").setProperty("/items", aItems);
                    this._oViewModel.setProperty("/fieldCount", String(aItems.length));
                    this.byId("attrFields").setText(aItems.length + " field" + (aItems.length !== 1 ? "s" : ""));
                }.bind(this));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load assigned fields: " + e.message);
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
                $expand: "prerequisite_role($select=role_id,description,master_data_type_master_data_type_id)",
                $select: "role_role_id,prerequisite_role_role_id,auto_pull"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    return {
                        role_id    : c.getProperty("prerequisite_role_role_id"),
                        description: c.getProperty("prerequisite_role/description") || "",
                        mdt        : c.getProperty("prerequisite_role/master_data_type_master_data_type_id") || "",
                        auto_pull  : c.getProperty("auto_pull")
                    };
                });
                this.getView().getModel("prereqroles").setProperty("/items", aItems);
                this._oViewModel.setProperty("/prereqRolesCount", String(aItems.length));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load prerequisite roles: " + e.message);
            });
        },

        _loadChangeLog: function () {
            var sRole = this._roleId();
            if (!sRole) { return; }
            var oBinding = this.byId("logTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "BPRole"),
                new Filter("entity_key",  FilterOperator.EQ, sRole)
            ]);
            oBinding.resume();
        },

        // ── Row navigation ───────────────────────────────────────────
        onFieldRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: encodeURIComponent(sFieldId) });
        },
        onFieldLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: encodeURIComponent(sFieldId) });
        },
        onPrereqLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("prereq").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: encodeURIComponent(sFieldId) });
        },
        onPrereqRolePress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext("prereqroles").getProperty("role_id");
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: encodeURIComponent(sId) });
        },
        onPrereqRoleLinkPress: function (oEvent) {
            var sId = oEvent.getSource().getBindingContext("prereqroles").getProperty("role_id");
            this.getOwnerComponent().getRouter().navTo("bpRoleDetail", { roleId: encodeURIComponent(sId) });
        },

        // ── Add actions (stubs that point to where dialogs would go) ─
        onAssignFields: function () { MessageToast.show("Assign Fields dialog — to be wired to a field picker."); },
        onAddPrereq: function ()    { MessageToast.show("Add Prerequisite dialog — to be wired."); },
        onAddPrereqRole: function () { MessageToast.show("Add Prerequisite Role dialog — to be wired."); },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId   = this.byId("inId").getValue().trim().toUpperCase();
            var sDesc = this.byId("inDescription").getValue().trim();
            var sMDT  = this.byId("selMDT").getSelectedKey();
            var sSeq  = this.byId("inSequence").getValue().trim();

            if (!sId) { MessageBox.error("BP Role ID is required."); return; }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Role ID must be uppercase letters, numbers, and underscores only.");
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
                oCtx.setProperty("master_data_type_master_data_type_id", sMDT);
                oCtx.setProperty("sequence", parseInt(sSeq, 10));
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("bpRoleUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Role saved successfully.");
                    if (bWasCreated) {
                        this._oCreateListBinding = null;
                        this.onNavBack();
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
            oCtx.requestObject().then(function (oData) {
                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/BPRoles", null, [], [], { $$updateGroupId: "bpRoleUpdate" });
                var oNewCtx = oListBinding.create({
                    role_id                             : "",
                    description                         : oData.description + " (Copy)",
                    master_data_type_master_data_type_id: oData.master_data_type_master_data_type_id,
                    initial_bp_required                 : oData.initial_bp_required,
                    sequence                            : (oData.sequence || 0) + 1,
                    active                              : false
                });
                this._oCreateListBinding = oListBinding;
                this.getView().setBindingContext(oNewCtx);
                this._oViewModel.setProperty("/isNew",   true);
                this._oViewModel.setProperty("/isDirty", true);
                this.byId("selMDT").setSelectedKey(oData.master_data_type_master_data_type_id);
                this._refreshHeader({ role_id: "", description: oData.description + " (Copy)", active: false });
                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Role copied — enter a new Role ID and press Save.");
            }.bind(this));
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("bpRoles");
        }
    });
});