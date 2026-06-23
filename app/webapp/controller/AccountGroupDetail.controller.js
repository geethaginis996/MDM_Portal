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
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, AssignFieldsHelper, FieldAssignmentEditHelper
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.AccountGroupDetail", Object.assign({}, AssignFieldsHelper, FieldAssignmentEditHelper, {

        onInit: function () {
            this._oViewModel = new JSONModel({
                busy       : false,
                isNew      : false,
                isDirty    : false,
                selectedTab: "general",
                fieldCount : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "assigned");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("accountGroupDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sRaw = decodeURIComponent(oEvent.getParameter("arguments").accountGroupId);
            var sId = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();
            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("assigned").setProperty("/items", []);

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindGroup(sId);
            }
        },

        _bindGroup: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            var sPath = "/AccountGroups('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $select        : "account_group_id,description,type,number_range_id,assignment_mode,one_time,active",
                    $$updateGroupId: "accountGroupUpdate"
                },
                events    : {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);
                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load account group: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Account group not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);
                            this._setTypeRadio(oData.type);
                            var oSel = this.byId("selNumberRange");
                            if (oSel) { oSel.setSelectedKey(oData.assignment_mode || "INTERNAL"); }
                        }.bind(this));
                    }.bind(this)
                }
            });
        },

        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  false);

            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/AccountGroups", null, [], [], {
                $$updateGroupId: "accountGroupUpdate"
            });
            var oContext = oListBinding.create({
                account_group_id: "",
                description     : "",
                type            : "CUSTOMER",
                number_range_id : "01",
                assignment_mode : "INTERNAL",
                one_time        : false,
                active          : true
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this._setTypeRadio("CUSTOMER");
            this.byId("selNumberRange").setSelectedKey("INTERNAL");
            this._refreshHeader({ account_group_id: "", description: "", type: "CUSTOMER", active: true });
        },

        _setTypeRadio: function (sType) {
            var oGroup = this.byId("typeGroup");
            if (oGroup) { oGroup.setSelectedIndex(sType === "VENDOR" ? 1 : 0); }
        },

        _refreshHeader: function (oData) {
            var sId   = oData.account_group_id || "";
            var sDesc = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " \u2014 " + sDesc : "")) : "New Account Group";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) { oBreadcrumb.setCurrentLocationText(sId || "New Account Group"); }

            var sType  = (oData.type === "VENDOR") ? "Vendor" : "Customer";
            var sRange = (oData.assignment_mode === "EXTERNAL")
                ? "External number range A\u2013Z"
                : "Internal number range 1\u2013999999";

            var oSubtitle = this.byId("pageSubtitle");
            if (oSubtitle) { oSubtitle.setText(sType + " Account Group \u00b7 " + sRange); }

            var bActive = this._truthy(oData.active);
            var oStatus = this.byId("attrStatus");
            if (oStatus) {
                oStatus.setText(bActive ? "Active" : "Inactive");
                oStatus.setState(bActive ? "Success" : "Error");
            }

            var oAttrType = this.byId("attrType");
            if (oAttrType) { oAttrType.setText(sType); }
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

        onFieldChange: function () { this._oViewModel.setProperty("/isDirty", true); },
        onTypeChange:  function () { this._oViewModel.setProperty("/isDirty", true); },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "fields") { this._loadFields(); }
        },

        _groupId: function () {
            var oCtx = this.getView().getBindingContext();
            return oCtx ? oCtx.getProperty("account_group_id") : null;
        },

        // ── Additional Fields tab ────────────────────────────────────
        _loadFields: function () {
            var sId = this._groupId();
            if (!sId) { return; }
            var oModel = this.getOwnerComponent().getModel();

            // Build the set of fields that also exist on any BP role, to flag
            // "Overrides BP Role?".
            var pRoleFields = oModel.bindList("/BPRoleFields", null, null, null, {
                $select: "field_field_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oSet = {};
                aCtx.forEach(function (c) { oSet[c.getProperty("field_field_id")] = true; });
                return oSet;
            }).catch(function () { return {}; });

            pRoleFields.then(function (oRoleFieldSet) {
                return oModel.bindList("/AccountGroupFields", null, [new Sorter("sequence")], [
                    new Filter("account_group_account_group_id", FilterOperator.EQ, sId)
                ], {
                    $expand: "field($select=field_id,description,data_type,main_group_group_id,sub_group_group_id)",
                    $select: "account_group_account_group_id,field_field_id,field_status,sequence"
                }).requestContexts(0, Infinity).then(function (aCtx) {
                    var aItems = aCtx.map(function (c) {
                        var sMain = c.getProperty("field/main_group_group_id") || "";
                        var sSub  = c.getProperty("field/sub_group_group_id") || "";
                        var sFid  = c.getProperty("field_field_id");
                        return {
                            field_id    : sFid,
                            description : c.getProperty("field/description") || "",
                            group_path  : (sMain + (sSub && sSub !== sMain ? " \u25b8 " + sSub : "")) || "\u2014",
                            field_status: c.getProperty("field_status"),
                            sequence    : c.getProperty("sequence"),
                            overrides   : !!oRoleFieldSet[sFid]
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

        // ── Row navigation ───────────────────────────────────────────
        onFieldRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this._openFieldAssignmentEdit({
                collection   : "/AccountGroupFields",
                fkName       : "account_group_account_group_id",
                fkValue      : this._groupId(),
                fieldId      : sFieldId,
                updateGroupId: "accountGroupUpdate",
                showReadOnly : false,
                onDone       : this._loadFields.bind(this)
            });
        },
        onFieldLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("assigned").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: encodeURIComponent(sFieldId.toLowerCase()) });
        },

        onAssignFields: function () {
            var sId = this._groupId();
            if (!sId) { MessageToast.show("Save the account group first."); return; }
            var aItems = this.getView().getModel("assigned").getProperty("/items") || [];
            var iMaxSeq = aItems.reduce(function (m, o) {
                return Math.max(m, parseInt(o.sequence, 10) || 0);
            }, 0);
            this._openAssignFields({
                collection   : "/AccountGroupFields",
                dialogTitle  : "Assign Fields",
                includeStatus: true,
                fkName       : "account_group_account_group_id",
                fkValue      : sId,
                updateGroupId: "accountGroupUpdate",
                assignedIds  : aItems.map(function (o) { return o.field_id; }),
                maxSequence  : iMaxSeq,
                onDone       : this._loadFields.bind(this)
            });
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId   = this.byId("inId").getValue().trim().toUpperCase();
            var sDesc = this.byId("inDescription").getValue().trim();
            var sType = this.byId("typeGroup").getSelectedIndex() === 1 ? "VENDOR" : "CUSTOMER";
            var sMode = this.byId("selNumberRange").getSelectedKey();

            if (!sId) { MessageBox.error("Account Group is required."); return; }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Account Group must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sDesc) { MessageBox.error("Description is required."); return; }

            this._oViewModel.setProperty("/busy", true);
            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                if (bIsNew) { oCtx.setProperty("account_group_id", sId); }
                oCtx.setProperty("type", sType);
                oCtx.setProperty("assignment_mode", sMode);
                oCtx.setProperty("number_range_id", sMode === "EXTERNAL" ? "02" : "01");
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("accountGroupUpdate")
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
                    MessageToast.show("Account group saved successfully.");
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
                this.getOwnerComponent().getModel().resetChanges("accountGroupUpdate");
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
            if (!oCtx) { MessageToast.show("No account group selected to copy."); return; }
            this.getOwnerComponent().getModel().resetChanges("accountGroupUpdate");
            oCtx.requestObject().then(function (oData) {
                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/AccountGroups", null, [], [], { $$updateGroupId: "accountGroupUpdate" });
                var oNewCtx = oListBinding.create({
                    account_group_id: "",
                    description     : oData.description + " (Copy)",
                    type            : oData.type,
                    number_range_id : oData.number_range_id,
                    assignment_mode : oData.assignment_mode,
                    one_time        : oData.one_time,
                    active          : false
                });
                this._oCreateListBinding = oListBinding;
                // Unbind the source record's object binding (set by the _bind* view
                // binding) before switching context; an object binding overrides
                // setBindingContext, otherwise the copy never appears.
                this.getView().unbindObject();
                this.getView().setBindingContext(oNewCtx);
                this._oViewModel.setProperty("/isNew",   true);
                this._oViewModel.setProperty("/isDirty", true);
                this._setTypeRadio(oData.type);
                this.byId("selNumberRange").setSelectedKey(oData.assignment_mode || "INTERNAL");
                this._refreshHeader({ account_group_id: "", description: oData.description + " (Copy)", type: oData.type, active: false });
                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Copied — enter a new Account Group ID and press Save.");
            }.bind(this));
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("accountGroups");
        }
    }));
});