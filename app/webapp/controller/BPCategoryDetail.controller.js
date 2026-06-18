sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "mdm/portal/controller/AssignFieldsHelper",
    "mdm/portal/controller/FieldAssignmentEditHelper"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter, MessageToast, MessageBox, AssignFieldsHelper, FieldAssignmentEditHelper
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.BPCategoryDetail", Object.assign({}, AssignFieldsHelper, FieldAssignmentEditHelper, {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy        : false,
                isDirty     : false,
                selectedTab : "general",
                fieldCount  : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "assigned");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("bpCategoryDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sId = decodeURIComponent(oEvent.getParameter("arguments").categoryId);
            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("assigned").setProperty("/items", []);
            this._bindCategory(sId);
        },

        _bindCategory: function (sId) {
            this._oViewModel.setProperty("/busy", true);
            var sPath = "/BPCategories('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: { $$updateGroupId: "bpCategoryUpdate" },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);
                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load category: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Category not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }.bind(this)
                }
            });
        },

        _refreshHeader: function (oData) {
            var sId   = oData.category_id || "";
            var sDesc = oData.description || "";
            this.byId("pageTitle").setText(sId + (sDesc ? " — " + sDesc : ""));

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) { oBreadcrumb.setCurrentLocationText(sId); }

            var sIcon = oData.icon;
            if (sIcon && sIcon.indexOf("sap-icon://") === 0) {
                this.byId("headerIcon").setSrc(sIcon);
            }

            var bActive = this._truthy(oData.active);
            this.byId("attrStatus").setText(bActive ? "Active" : "Inactive");
            this.byId("attrStatus").setState(bActive ? "Success" : "Error");
        },

        _truthy: function (v) {
            if (typeof v === "string") {
                var s = v.trim().toLowerCase();
                return (s === "yes" || s === "true" || s === "1" || s === "active" || s === "x");
            }
            return v === true || v === 1;
        },

        // ── Field status formatters ──────────────────────────────────
        formatStatusText: function (sStatus) {
            if (sStatus === "REQUIRED") { return "Required"; }
            if (sStatus === "OPTIONAL") { return "Optional"; }
            if (sStatus === "SUPPRESS") { return "Suppress"; }
            return sStatus || "—";
        },
        formatStatusState: function (sStatus) {
            if (sStatus === "REQUIRED") { return "Warning"; }
            if (sStatus === "OPTIONAL") { return "Information"; }
            return "None";
        },

        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tabs ─────────────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "fields")    { this._loadFields(); }
            if (sKey === "changelog") { this._loadChangeLog(); }
        },

        _categoryId: function () {
            var oCtx = this.getView().getBindingContext();
            return oCtx ? oCtx.getProperty("category_id") : null;
        },

        _loadFields: function () {
            var sCat = this._categoryId();
            if (!sCat) { return; }
            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/BPCategoryFields", null, [new Sorter("sequence")], [
                new Filter("category_category_id", FilterOperator.EQ, sCat)
            ], {
                $expand: "field($select=field_id,description,data_type,main_group_group_id,sub_group_group_id)",
                $select: "category_category_id,field_field_id,field_status,sequence"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    return {
                        field_id    : c.getProperty("field_field_id"),
                        description : c.getProperty("field/description") || "",
                        data_type   : c.getProperty("field/data_type") || "",
                        main_group  : c.getProperty("field/main_group_group_id") || "—",
                        sub_group   : c.getProperty("field/sub_group_group_id") || "—",
                        field_status: c.getProperty("field_status"),
                        sequence    : c.getProperty("sequence")
                    };
                });
                this.getView().getModel("assigned").setProperty("/items", aItems);
                this._oViewModel.setProperty("/fieldCount", String(aItems.length));
                this.byId("attrFields").setText(aItems.length + " field" + (aItems.length !== 1 ? "s" : ""));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load category fields: " + e.message);
            });
        },

        // ── Removal: Field Assignments tab ──────────────────────────────
        // The row is addressed by its composite key directly (no need to have
        // it loaded as a list-binding context first), then deleted and the
        // tab reloaded — same pattern used for BP Role's three field/role tabs.
        _deleteAssignedField: function (sFieldId) {
            var oModel = this.getOwnerComponent().getModel();
            var sPath = "/BPCategoryFields(category_category_id='" + this._categoryId() +
                "',field_field_id='" + sFieldId + "')";
            var oCtx = oModel.bindContext(sPath, null).getBoundContext();

            oCtx.delete().then(function () {
                MessageToast.show("Removed.");
                this._loadFields();
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not remove: " + (e && e.message || "Unknown error"));
            });
        },

        onRemoveAssignedField: function (oEvent) {
            var oCtx     = oEvent.getSource().getBindingContext("assigned");
            var sFieldId = oCtx.getProperty("field_id");
            MessageBox.confirm("Remove \u201c" + sFieldId + "\u201d from this category's Field Assignments?", {
                title  : "Remove Field",
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    this._deleteAssignedField(sFieldId);
                }.bind(this)
            });
        },

        _loadChangeLog: function () {
            var sCat = this._categoryId();
            if (!sCat) { return; }
            var oBinding = this.byId("logTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "BPCategory"),
                new Filter("entity_key",  FilterOperator.EQ, sCat)
            ]);
            oBinding.resume();
        },

        onFieldRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this._openFieldAssignmentEdit({
                collection   : "/BPCategoryFields",
                fkName       : "category_category_id",
                fkValue      : this._categoryId(),
                fieldId      : sFieldId,
                updateGroupId: "bpCategoryUpdate",
                showReadOnly : false,
                onDone       : this._loadFields.bind(this)
            });
        },
        onFieldLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: encodeURIComponent(sFieldId) });
        },

        onAssignField: function () {
            var sCat = this._categoryId();
            if (!sCat) { MessageToast.show("Save the category first."); return; }
            var aItems = this.getView().getModel("assigned").getProperty("/items") || [];
            var iMaxSeq = aItems.reduce(function (m, o) {
                return Math.max(m, parseInt(o.sequence, 10) || 0);
            }, 0);
            this._openAssignFields({
                collection   : "/BPCategoryFields",
                dialogTitle  : "Assign Fields",
                includeStatus: true,
                fkName       : "category_category_id",
                fkValue      : sCat,
                updateGroupId: "bpCategoryUpdate",
                assignedIds  : aItems.map(function (o) { return o.field_id; }),
                maxSequence  : iMaxSeq,
                onDone       : this._loadFields.bind(this)
            });
        },

        // ── Save (description / icon / active only) ──────────────────
        onSave: function () {
            var sDesc = this.byId("inDescription").getValue().trim();
            if (!sDesc) {
                MessageBox.error("Description is required.");
                return;
            }
            this._oViewModel.setProperty("/busy", true);
            // description, icon, active are two-way bound — already pending.
            this.getOwnerComponent().getModel().submitBatch("bpCategoryUpdate")
                .then(function () {
                    this._oViewModel.setProperty("/busy", false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Category saved successfully.");
                    var oCtx = this.getView().getBindingContext();
                    if (oCtx) {
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
                this.getOwnerComponent().getModel().resetChanges("bpCategoryUpdate");
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

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("bpCategories");
        }
    }));
});