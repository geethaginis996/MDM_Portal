sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/ui/layout/form/SimpleForm"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, Dialog, Button, Input, Label, SimpleForm
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ReleaseCriteriaDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy       : false,
                isNew      : false,
                isDirty    : false,
                selectedTab: "general",
                valueCount : "0",
                usageCount : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "values");
            this.getView().setModel(new JSONModel({ items: [] }), "usage");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("releaseCriteriaDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var sRaw = decodeURIComponent(oEvent.getParameter("arguments").criteriaId);
            var sId  = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();

            try { this.getOwnerComponent().getModel().resetChanges("releaseCriteriaUpdate"); } catch (e) { /* no pending */ }

            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this._oViewModel.setProperty("/valueCount", "0");
            this._oViewModel.setProperty("/usageCount", "0");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("values").setProperty("/items", []);
            this.getView().getModel("usage").setProperty("/items", []);

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindCriteria(sId);
            }
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindCriteria: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            var sPath = "/StrategyCharacteristics('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $select: "characteristic_id,description,data_type,active," +
                             "master_data_type_master_data_type_id,field_field_id",
                    $$updateGroupId: "releaseCriteriaUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load release criteria: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Release criteria not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);

                            var oSelApplies = this.byId("selAppliesTo");
                            if (oSelApplies) { oSelApplies.setSelectedKey(oData.master_data_type_master_data_type_id); }

                            var oSelField = this.byId("selField");
                            if (oSelField) { oSelField.setSelectedKey(oData.field_field_id); }

                            var oSelDataType = this.byId("selDataType");
                            if (oSelDataType) { oSelDataType.setSelectedKey(oData.data_type); }

                            // Load tab badge data eagerly, right when the record loads
                            // — not lazily on tab-select — so both tab counts are
                            // correct immediately, regardless of which tab is active.
                            this._loadValues();
                            this._loadUsage();
                        }.bind(this));

                        this.byId("inId").setEditable(false);
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  false);

            this.getView().unbindObject();

            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/StrategyCharacteristics", null, [], [], {
                $$updateGroupId: "releaseCriteriaUpdate"
            });
            var oContext = oListBinding.create({
                characteristic_id: "",
                description       : "",
                data_type         : "STRING",
                active            : true,
                master_data_type_master_data_type_id: null,
                field_field_id    : null
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this._refreshHeader({ characteristic_id: "", description: "", active: true });

            this.byId("inId").setEditable(true);
            this.byId("selAppliesTo").setSelectedKey("");
            this.byId("selField").setSelectedKey("");
            this.byId("selDataType").setSelectedKey("STRING");
        },

        // ── Header refresh ───────────────────────────────────────────
        _refreshHeader: function (oData) {
            var oView = this.getView();
            if (!oView || oView.bIsDestroyed) { return; }

            var sId    = oData.characteristic_id || "";
            var sDesc  = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " — " + sDesc : "")) : "New Release Criteria";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) { oBreadcrumb.setCurrentLocationText(sId || "New Release Criteria"); }

            var oStatus = this.byId("attrStatus");
            if (oStatus) { oStatus.setText(oData.active === false ? "Inactive" : "Active"); }

            var oCreated = this.byId("attrCreated");
            if (oCreated) { oCreated.setText(oData.createdBy || "\u2014"); }

            var oDate = this.byId("attrDate");
            if (oDate) {
                oDate.setText(oData.createdAt ? new Date(oData.createdAt).toLocaleDateString() : "\u2014");
            }
        },

        // ── Dirty flag ───────────────────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            // Data is already loaded eagerly on bind; re-fetch on tab-select too
            // so the tab reflects any change made elsewhere in the same session.
            if (sKey === "values") { this._loadValues(); }
            if (sKey === "usage")  { this._loadUsage(); }
        },

        // ── Allowed Values tab ───────────────────────────────────────
        _loadValues: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList(oCtx.getPath() + "/values", null, [new Sorter("value_key")]).requestContexts(0, Infinity)
                .then(function (aCtx) {
                    var oView = this.getView();
                    if (!oView || oView.bIsDestroyed) { return; }

                    var aItems = aCtx.map(function (c) {
                        return {
                            value_key  : c.getProperty("value_key"),
                            description: c.getProperty("description")
                        };
                    });
                    oView.getModel("values").setProperty("/items", aItems);
                    this._oViewModel.setProperty("/valueCount", String(aItems.length));
                }.bind(this)).catch(function () {
                    // New/unsaved record has no nav path yet — leave empty, no error.
                });
        },

        onAddValue: function () {
            if (this._oViewModel.getProperty("/isNew")) {
                MessageToast.show("Save the criteria first before adding allowed values.");
                return;
            }
            if (!this._oAddValueDialog) {
                var oKeyInput  = new Input({ placeholder: "e.g. DOM", maxLength: 40 });
                var oDescInput = new Input({ placeholder: "e.g. Domestic Customer", maxLength: 100 });

                this._oAddValueDialog = new Dialog({
                    title  : "Add Allowed Value",
                    content: new SimpleForm({
                        editable: true,
                        layout  : "ResponsiveGridLayout",
                        content : [
                            new Label({ text: "Key", required: true }), oKeyInput,
                            new Label({ text: "Description", required: true }), oDescInput
                        ]
                    }),
                    beginButton: new Button({
                        text: "Add",
                        type: "Emphasized",
                        press: function () {
                            var sKey  = oKeyInput.getValue().trim();
                            var sDesc = oDescInput.getValue().trim();
                            if (!sKey || !sDesc) {
                                MessageBox.error("Both Key and Description are required.");
                                return;
                            }
                            this._createValue(sKey, sDesc);
                            oKeyInput.setValue("");
                            oDescInput.setValue("");
                            this._oAddValueDialog.close();
                        }.bind(this)
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () { this._oAddValueDialog.close(); }.bind(this)
                    }),
                    afterClose: function () {
                        oKeyInput.setValue("");
                        oDescInput.setValue("");
                    }
                });
                this.getView().addDependent(this._oAddValueDialog);
            }
            this._oAddValueDialog.open();
        },

        _createValue: function (sKey, sDesc) {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }

            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList(oCtx.getPath() + "/values", null, [], [], {
                $$updateGroupId: "releaseCriteriaUpdate"
            });
            oListBinding.create({ value_key: sKey, description: sDesc });

            oModel.submitBatch("releaseCriteriaUpdate")
                .then(function () {
                    MessageToast.show("Value added.");
                    this._loadValues();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not add value: " + e.message);
                });
        },

        onDeleteValue: function (oEvent) {
            var oRowCtx = oEvent.getSource().getBindingContext("values");
            var sKey    = oRowCtx.getProperty("value_key");

            MessageBox.confirm("Delete allowed value \"" + sKey + "\"?", {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }

                    var oCtx = this.getView().getBindingContext();
                    if (!oCtx) { return; }
                    var sId = oCtx.getProperty("characteristic_id");

                    var oModel = this.getOwnerComponent().getModel();
                    oModel.bindContext(
                        "/StrategyCharacteristicValues(characteristic_characteristic_id='" + sId + "',value_key='" + sKey + "')"
                    ).getBoundContext().delete("$auto")
                        .then(function () {
                            MessageToast.show("Value deleted.");
                            this._loadValues();
                        }.bind(this))
                        .catch(function (e) {
                            MessageBox.error("Delete failed: " + e.message);
                        }.bind(this));
                }.bind(this)
            });
        },

        // ── Used By Strategies tab ───────────────────────────────────
        _loadUsage: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("characteristic_id");
            if (!sId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/ReleaseStrategyValues", null, null, [
                new Filter("characteristic_characteristic_id", FilterOperator.EQ, sId)
            ], {
                $expand: "strategy($select=strategy_id,description,master_data_type_master_data_type_id,active)"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oView = this.getView();
                if (!oView || oView.bIsDestroyed) { return; }

                var aItems = aCtx.map(function (c) {
                    var oStrategy = c.getObject().strategy || {};
                    return {
                        strategy_id      : oStrategy.strategy_id,
                        description      : oStrategy.description,
                        master_data_type : oStrategy.master_data_type_master_data_type_id,
                        active           : oStrategy.active
                    };
                }).filter(function (o) { return !!o.strategy_id; });

                oView.getModel("usage").setProperty("/items", aItems);
                this._oViewModel.setProperty("/usageCount", String(aItems.length));
            }.bind(this)).catch(function () {
                // New/unsaved record or no matches yet — leave empty, no error.
            });
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId         = this.byId("inId").getValue().trim().toUpperCase();
            var sDesc       = this.byId("inDescription").getValue().trim();
            var sAppliesTo  = this.byId("selAppliesTo").getSelectedKey();
            var sField      = this.byId("selField").getSelectedKey();
            var sDataType   = this.byId("selDataType").getSelectedKey();

            if (!sId) { MessageBox.error("Criteria ID is required."); return; }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Criteria ID must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sDesc)      { MessageBox.error("Description is required."); return; }
            if (!sAppliesTo) { MessageBox.error("Applies To is required."); return; }
            if (!sField)     { MessageBox.error("Source Field is required."); return; }
            if (!sDataType)  { MessageBox.error("Data Type is required."); return; }

            this._oViewModel.setProperty("/busy", true);

            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                if (bIsNew) { oCtx.setProperty("characteristic_id", sId); }
                oCtx.setProperty("master_data_type_master_data_type_id", sAppliesTo);
                oCtx.setProperty("field_field_id", sField);
                oCtx.setProperty("data_type", sDataType);
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCriteriaUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Release criteria saved successfully.");

                    if (bWasCreated) {
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
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("releaseCriteriaUpdate");
                this._oViewModel.setProperty("/isDirty", false);
                this.onNavBack();
            }.bind(this);

            if (this._oViewModel.getProperty("/isDirty")) {
                MessageBox.confirm("Discard unsaved changes?", {
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) { fnGoBack(); }
                    }
                });
            } else {
                fnGoBack();
            }
        },

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("releaseCriteria");
        }
    });
});
